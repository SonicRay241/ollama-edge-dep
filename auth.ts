import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { dirname } from "path";

const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const PORT = parseInt(process.env.PORT || "8080");
const API_KEYS = (process.env.API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);
const LOG_PATH = process.env.LOG_PATH || "state/proxy-costs.jsonl";

function validateToken(token: string): boolean {
  if (API_KEYS.length === 0) return true;
  return API_KEYS.includes(token);
}

function ensureLogDir(path: string) {
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
  console.log(`${record.timestamp}: Logging to ${LOG_PATH}`)
  ensureLogDir(LOG_PATH);
  try {
    appendFileSync(LOG_PATH, JSON.stringify(record) + "\n", "utf-8");
    console.log(`${record.timestamp}: appended ${LOG_PATH}`);
  } catch (err) {
    console.error(`${record.timestamp}: FAILED to write ${LOG_PATH}`, err);
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

  if (!existsSync(LOG_PATH)) {
    return result;
  }

  const today = todayDate();
  const text = readFileSync(LOG_PATH, "utf-8");
  const lines = text.split("\n").filter(Boolean);

  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (rec.date !== today) continue;
      if (rec.key_hash !== keyHash) continue;

      result.entries++;
      result.total_input_tokens += rec.input_tokens || 0;
      result.total_output_tokens += rec.output_tokens || 0;
      result.total_tokens += rec.total_tokens || 0;

      const model = rec.model || "unknown";
      if (!result.by_model[model]) {
        result.by_model[model] = { input: 0, output: 0, total: 0 };
      }
      result.by_model[model].input += rec.input_tokens || 0;
      result.by_model[model].output += rec.output_tokens || 0;
      result.by_model[model].total += rec.total_tokens || 0;
    } catch {}
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

    const proxyReq = new Request(targetUrl, {
      method: req.method,
      headers,
      body: req.body,
      duplex: "half",
    } as any);

    const res = await fetch(proxyReq);
    console.log(`${timestamp} upstream ${res.status} ${res.statusText} content-type=${res.headers.get("content-type")}`);

    // Only intercept generate/chat responses with bodies
    if ((url.pathname === "/api/generate" || url.pathname === "/api/chat") && res.body) {
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
console.log(`Usage log: ${LOG_PATH}`);
console.log(`Usage endpoint: http://localhost:${server.port}/usage`);
