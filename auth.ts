import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { dirname } from "path";
import { Database } from "bun:sqlite";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const PORT = parseInt(process.env.PORT || "8080");
const API_KEYS = (process.env.API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);
const LOG_PATH = process.env.LOG_PATH || "state/proxy-costs.jsonl";
const DB_PATH = process.env.DB_PATH || "state/proxy-costs.db";

function validateToken(token: string): boolean {
  if (API_KEYS.length === 0) return true;
  return API_KEYS.includes(token);
}

function ensureDir(path: string) {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

const db = (() => {
  ensureDir(DB_PATH);
  const database = new Database(DB_PATH);
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      date TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      endpoint TEXT NOT NULL,
      key_hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_date_key ON usage_logs(date, key_hash);
  `);
  return database;
})();

const insertUsage = db.prepare(
  "INSERT INTO usage_logs (timestamp, date, model, input_tokens, output_tokens, total_tokens, endpoint, key_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);

function migrateFromJsonl() {
  if (!existsSync(LOG_PATH)) return;

  console.log(`Migrating legacy usage log from ${LOG_PATH} to ${DB_PATH}`);
  const text = readFileSync(LOG_PATH, "utf-8");
  const lines = text.split("\n").filter(Boolean);
  let migrated = 0;

  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      const input = rec.input_tokens || 0;
      const output = rec.output_tokens || 0;
      insertUsage.run(
        rec.timestamp,
        rec.date,
        rec.model || "unknown",
        input,
        output,
        rec.total_tokens ?? input + output,
        rec.endpoint || "unknown",
        rec.key_hash || "unknown"
      );
      migrated++;
    } catch (err) {
      console.error("Failed to migrate usage record:", err);
    }
  }

  try {
    unlinkSync(LOG_PATH);
    console.log(`Deleted migrated log file ${LOG_PATH}`);
  } catch (err) {
    console.error(`Failed to delete ${LOG_PATH}:`, err);
  }

  console.log(`Migrated ${migrated} records`);
}

migrateFromJsonl();

function logUsage(record: {
  timestamp: string;
  date: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  endpoint: string;
  key_hash: string;
}) {
  console.log(`${record.timestamp}: Logging usage for ${record.key_hash}`);
  try {
    insertUsage.run(
      record.timestamp,
      record.date,
      record.model,
      record.input_tokens,
      record.output_tokens,
      record.total_tokens,
      record.endpoint,
      record.key_hash
    );
    console.log(`${record.timestamp}: inserted usage record`);
  } catch (err) {
    console.error(`${record.timestamp}: FAILED to insert usage record`, err);
  }
}

function parseGenerateBody(body: any) {
  return {
    model: body?.model || "unknown",
    input_tokens: body?.prompt_eval_count || 0,
    output_tokens: body?.eval_count || 0,
  };
}

function parseChatBody(body: any) {
  return {
    model: body?.model || "unknown",
    input_tokens: body?.prompt_eval_count || 0,
    output_tokens: body?.eval_count || 0,
  };
}

function parseOpenAIChatCompletionBody(text: string, defaultModel: string): { model: string; input_tokens: number; output_tokens: number } | null {
  // OpenAI-compatible SSE: lines like "data: {...}" or a single JSON object.
  // Ollama's /v1/chat/completions may stream chunks and a final chunk containing usage.
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
  let model = defaultModel;

  const lines = text.split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let jsonText = line;
    if (line.startsWith("data:")) {
      jsonText = line.slice(5).trim();
    }

    if (jsonText === "[DONE]") continue;

    try {
      const json = JSON.parse(jsonText);
      if (json.model) model = json.model;
      if (json.usage) {
        lastUsage = json.usage;
      }
    } catch {}
  }

  if (!lastUsage) return null;

  return {
    model: model || "unknown",
    input_tokens: lastUsage.prompt_tokens || 0,
    output_tokens: lastUsage.completion_tokens || 0,
  };
}

async function parseOllamaResponse(
  endpoint: string,
  contentType: string | null,
  body: Uint8Array
): Promise<{ model: string; input_tokens: number; output_tokens: number } | null> {
  const text = new TextDecoder().decode(body);

  if (endpoint === "/api/generate") {
    try {
      const json = JSON.parse(text);
      return parseGenerateBody(json);
    } catch {
      // streaming: last line has done=true
      const lines = text.trim().split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const json = JSON.parse(lines[i]);
          if (json.done) {
            return parseGenerateBody(json);
          }
        } catch {}
      }
    }
  }

  if (endpoint === "/api/chat") {
    try {
      const json = JSON.parse(text);
      return parseChatBody(json);
    } catch {
      const lines = text.trim().split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const json = JSON.parse(lines[i]);
          if (json.done) {
            return parseChatBody(json);
          }
        } catch {}
      }
    }
  }

  if (endpoint === "/v1/chat/completions") {
    return parseOpenAIChatCompletionBody(text, "unknown");
  }

  return null;
}

function readTodayUsage(keyHash: string): {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  entries: number;
  by_model: Record<string, { input: number; output: number; total: number }>;
} {
  const result = {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    entries: 0,
    by_model: {} as Record<string, { input: number; output: number; total: number }>,
  };

  const today = todayDate();
  const rows = db
    .query<
      { model: string; input: number; output: number; total: number; entries: number },
      [string, string]
    >(
      "SELECT model, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(total_tokens) AS total, COUNT(*) AS entries FROM usage_logs WHERE date = ? AND key_hash = ? GROUP BY model"
    )
    .all(today, keyHash);

  for (const row of rows) {
    result.entries += row.entries;
    result.total_input_tokens += row.input;
    result.total_output_tokens += row.output;
    result.total_tokens += row.total;
    result.by_model[row.model] = {
      input: row.input,
      output: row.output,
      total: row.total,
    };
  }

  return result;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} ${req.method} ${url.pathname} from ${req.headers.get("x-forwarded-for") || "?"}`);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

    if (!validateToken(token)) {
      console.log(`${timestamp} 401 Unauthorized`);
      return new Response("Unauthorized", { status: 401 });
    }

    const keyHash = hashToken(token);

    // Usage endpoint: returns only the authenticated key's usage for today
    if (url.pathname === "/usage") {
      const usage = readTodayUsage(keyHash);
      console.log(`${timestamp} /usage entries=${usage.entries}`);
      return new Response(JSON.stringify({
        date: todayDate(),
        ...usage,
      }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const targetUrl = `${OLLAMA_URL}${url.pathname}${url.search}`;

    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      if (k.toLowerCase() !== "authorization") headers[k] = v;
    });

    let body: BodyInit | null = req.body;

    // Middleware: ensure Ollama returns token usage for logging.
    if (req.method !== "GET" && req.method !== "HEAD" && (
      url.pathname === "/api/generate" ||
      url.pathname === "/api/chat" ||
      url.pathname === "/v1/chat/completions"
    )) {
      try {
        const original = await req.json();

        if (url.pathname === "/v1/chat/completions") {
          // OpenAI-compatible: request usage in the final streaming chunk.
          original.stream_options = original.stream_options || {};
          if (original.stream !== false) {
            original.stream_options.include_usage = true;
          }
        } else {
          // Native Ollama endpoints: no special flag needed; usage is in the done chunk.
          // Ensure streaming is enabled so we get a done chunk with counts.
          if (original.stream === undefined) {
            original.stream = true;
          }
        }

        body = JSON.stringify(original);
        headers["content-type"] = "application/json";
        headers["content-length"] = String(Buffer.byteLength(body, "utf-8"));
        console.log(`${timestamp} injected usage flags for ${url.pathname}`);
      } catch (err) {
        // Not JSON or no body; pass through unchanged.
        console.log(`${timestamp} could not inject usage flags: ${err}`);
      }
    }

    const proxyReq = new Request(targetUrl, {
      method: req.method,
      headers,
      body,
      duplex: "half",
    } as any);

    const res = await fetch(proxyReq);
    console.log(`${timestamp} upstream ${res.status} ${res.statusText} content-type=${res.headers.get("content-type")}`);

    const isLoggable =
      url.pathname === "/api/generate" ||
      url.pathname === "/api/chat" ||
      url.pathname === "/v1/chat/completions";

    if (isLoggable && res.body) {
      const chunks: Uint8Array[] = [];
      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const fullBody = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        fullBody.set(c, offset);
        offset += c.length;
      }

      const parsed = await parseOllamaResponse(url.pathname, res.headers.get("content-type"), fullBody);
      console.log(`${timestamp} parsed=${parsed ? JSON.stringify(parsed) : "null"} body_bytes=${fullBody.length}`);
      if (parsed) {
        logUsage({
          timestamp: new Date().toISOString(),
          date: todayDate(),
          model: parsed.model,
          input_tokens: parsed.input_tokens,
          output_tokens: parsed.output_tokens,
          total_tokens: parsed.input_tokens + parsed.output_tokens,
          endpoint: url.pathname,
          key_hash: keyHash,
        });
      } else {
        console.log(`${timestamp} skipped logging: endpoint=${url.pathname} content-type=${res.headers.get("content-type")}`);
      }

      return new Response(fullBody, {
        status: res.status,
        headers: res.headers,
      });
    }

    return new Response(res.body, {
      status: res.status,
      headers: res.headers,
    });
  },
});

console.log(`Auth proxy running on port ${server.port}`);
console.log(`Usage DB: ${DB_PATH}`);
console.log(`Usage endpoint: http://localhost:${server.port}/usage`);
