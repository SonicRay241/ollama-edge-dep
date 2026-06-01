import { USER_MAPPINGS } from "./constants";

export const userTokenRegistry = new Map<string, string>();

function initRegistry() {
  const pairs = USER_MAPPINGS.split(",");
  pairs.forEach((pair) => {
    const [bearerToken, userId] = pair.split(":");

    if (bearerToken && userId) userTokenRegistry.set(bearerToken, userId);
  });
}

export function getDiscordUserId(bearerToken: string): string | null {
  return userTokenRegistry.get(bearerToken) || null
}

initRegistry()