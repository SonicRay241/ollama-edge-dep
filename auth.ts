const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const PORT = parseInt(process.env.PORT || "8080");
const API_KEYS = (process.env.API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);

function validateToken(token: string): boolean {
  if (API_KEYS.length === 0) return true;
  return API_KEYS.includes(token);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    
    if (!validateToken(token)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const url = new URL(req.url);
    const targetUrl = `${OLLAMA_URL}${url.pathname}${url.search}`;
    
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      if (k !== "authorization") headers[k] = v;
    });

    const proxyReq = new Request(targetUrl, {
      method: req.method,
      headers,
      body: req.body,
      duplex: "half"
    });

    const res = await fetch(proxyReq);
    return new Response(res.body, {
      status: res.status,
      headers: res.headers
    });
  }
});

console.log(`Auth proxy running on port ${server.port}`);