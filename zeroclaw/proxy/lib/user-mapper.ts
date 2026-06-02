import { USER_MAPPINGS, USER_MAPPINGS_OPEN_WEBUI } from "./constants";

export const userTokenRegistry = new Map<string, string>();

function initRegistry(mappings: string) {
  const pairs = mappings.split(",");
  pairs.forEach((pair) => {
    const [bearerToken, userId] = pair.split(":");

    if (bearerToken && userId) userTokenRegistry.set(bearerToken, userId);
  });
}

export function getDiscordUserId(token: string | null): string | null {
  if (!token) return null
  return userTokenRegistry.get(token) || null
}

initRegistry(USER_MAPPINGS)
initRegistry(USER_MAPPINGS_OPEN_WEBUI)