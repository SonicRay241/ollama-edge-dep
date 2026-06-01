export const ZC_PROTOCOL = process.env.ZC_PROTOCOL ?? "ws"
export const ZC_HOST      = process.env.ZC_HOST      ?? "localhost";
export const ZC_WS_URL    = process.env.ZC_WS_URL   ?? `${ZC_PROTOCOL}://${ZC_HOST}/ws/chat`;
export const HTTP_PORT    = Number(process.env.HTTP_PORT ?? "8080");
export const ZC_AGENT     = process.env.ZC_AGENT     ?? "default";

export const USER_MAPPINGS = process.env.PROXY_USER_TOKEN_MAPPING || "";