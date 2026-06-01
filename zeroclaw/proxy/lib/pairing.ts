const TOKEN_FILE = "./.zeroclaw-token";
const ZEROCLAW_URL = process.env.ZEROCLAW_URL || "https://openclaw.rayy.dev";

export async function loadOrPair(): Promise<string> {
  try {
    const token = await Bun.file(TOKEN_FILE).text();
    return token.trim();
  } catch {
    // No saved token — must pair
  }

  const code = process.env.PAIRING_CODE;
  if (!code) {
    console.error(
      "No saved token found and PAIRING_CODE is not set. Shutting down.",
    );
    process.exit(1);
  }

  console.log("Pairing with ZeroClaw...");
  const res = await fetch(`${ZEROCLAW_URL}/pair`, {
    method: "POST",
    headers: { "X-Pairing-Code": code },
  });

  if (!res.ok) {
    console.error(`Pairing failed: ${res.status} ${res.statusText}`);
    const body = await res.text();
    console.error(body);
    process.exit(1);
  }

  const data = (await res.json()) as { token: string };
  const token = data.token;

  if (!token) {
    console.error("Pairing response did not contain a token.");
    process.exit(1);
  }

  await Bun.write(TOKEN_FILE, token);
  console.log("Paired successfully. Token saved.");
  return token;
}
