import type { ChatContentPart, ChatMessage } from "./types";

function normalizeMessageContent(content: string | ChatContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (part.type === "text") {
        return part.text;
      }

      if (part.type === "image_url") {
        return `[IMAGE:${part.image_url.url}]`;
      }

      return "";
    })
    .join(" ");
}

export function formatMessagesForZC(messages: ChatMessage[]): string {
  return normalizeMessageContent(messages[messages.length - 1]?.content || "")
}

export function truncateString(str: string, maxLength: number) {
  if (str.length > maxLength) {
    return str.slice(0, maxLength) + '...';
  }
  return str;
}
