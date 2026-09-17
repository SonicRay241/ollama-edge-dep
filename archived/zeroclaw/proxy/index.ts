import { HTTP_PORT, ZC_AGENT, ZC_WS_URL } from "./lib/constants";
import { loadOrPair } from "./lib/pairing";
import { createServer } from "./lib/server";

const ZC_TOKEN = await loadOrPair();

createServer(ZC_TOKEN)
console.log(`Translation proxy listening on http://localhost:${HTTP_PORT}`);
console.log(`Connected to ZeroClaw at ${ZC_WS_URL}`);
console.log(`Using agent: ${ZC_AGENT}`);