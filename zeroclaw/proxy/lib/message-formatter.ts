import type { ChatMessage } from "./types";

export function formatMessagesForZC(messages: ChatMessage[]): string {
  // ZeroClaw expects a single text message per turn.
  // We concatenate the conversation into a simple prompt.
  // System messages are prepended as context instructions.
  const systemParts: string[] = [];
  const userParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemParts.push(msg.content);
    } else if (msg.role === "user") {
      userParts.push(msg.content);
    } else if (msg.role === "assistant") {
      userParts.push(`Assistant: ${msg.content}`);
    } else if (msg.role === "tool") {
      userParts.push(`Tool result: ${msg.content}`);
    }
  }

  const parts: string[] = [];
  if (systemParts.length) {
    parts.push(`[System instructions]\n${systemParts.join("\n")}`);
  }
  if (userParts.length) {
    parts.push(userParts.join("\n\n"));
  }
  return parts.join("\n\n");
}
