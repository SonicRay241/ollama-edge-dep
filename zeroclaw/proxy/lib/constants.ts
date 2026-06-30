export const ZC_PROTOCOL = process.env.ZC_PROTOCOL ?? "ws"
export const ZC_HOST      = process.env.ZC_HOST      ?? "localhost";
export const ZC_WS_URL    = process.env.ZC_WS_URL   ?? `${ZC_PROTOCOL}://${ZC_HOST}/ws/chat`;
export const HTTP_PORT    = Number(process.env.HTTP_PORT ?? "3000");
export const ZC_AGENT     = process.env.ZC_AGENT     ?? "default";

export const USER_MAPPINGS = process.env.PROXY_USER_TOKEN_MAPPING || ""; // bearer:uid
export const USER_MAPPINGS_OPEN_WEBUI = process.env.PROXY_USER_TOKEN_MAPPING_OPEN_WEBUI || ""; // reads openwebui email, and confirms the bearer token
export const DEFAULT_API_KEY = process.env.DEFAULT_API_KEY || "";

export const COST_JSONL_PATH = process.env.COST_JSONL_PATH ?? "/zeroclaw-data/.zeroclaw/data/state/costs.jsonl";
export const SYSTEM_KEY = process.env.SYSTEM_KEY ?? "";
