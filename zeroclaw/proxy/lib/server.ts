import { type IncomingHttpHeaders } from "http";
import { getDiscordUserId } from "./user-mapper";
import type { ChatCompletionBody } from "./types";
import { ZCBridge } from "./bridge";
import { formatMessagesForZC } from "./message-formatter";
import { sseEvent } from "./sse";
import { HTTP_PORT } from "./constants";

function extractBearer(auth: string | null): string | null {
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export const createServer = (zcToken: string) =>
  Bun.serve({
    port: HTTP_PORT,
    async fetch(req, server) {
      const url = new URL(req.url);
      
      // Health check
      if (url.pathname === "/health") {
        return new Response("ok");
      }

      // Models
      if (url.pathname === "/models" || url.pathname === "/v1/models") {
        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              {
                id: "Nanakusaa",
                object: "model",
                created: 0,
                owned_by: "zeroclaw",
              },
            ],
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      // Only handle chat completions
      if (
        url.pathname !== "/chat/completions" &&
        url.pathname !== "/v1/chat/completions"
      ) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
        });
      }

      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Method not allowed" }), {
          status: 405,
        });
      }

      const bearer = extractBearer(
        req.headers.get("authorization"),
      );

      const openWebuiEmail = req.headers.get("x-openwebui-user-email")

      if (!bearer && !openWebuiEmail) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Missing Authorization header",
              type: "auth_error",
              code: "missing_auth",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      const discordUserId = getDiscordUserId(openWebuiEmail || bearer);

      if (!discordUserId) {
        return new Response(
          JSON.stringify({
            error: {
              message: "Missing Authorization header",
              type: "auth_error",
              code: "missing_auth",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      // Resolve session ID
      const chatId =
        req.headers.get("x-openwebui-chat-id") ??
        req.headers.get("X-OpenWebUI-Chat-Id");
      const sessionId = chatId
        ? `openwebui_${chatId}_${discordUserId}`
        : `openwebui_default_${discordUserId}`;

      let body: ChatCompletionBody;
      try {
        body = (await req.json()) as ChatCompletionBody;
      } catch {
        return new Response(
          JSON.stringify({
            error: {
              message: "Invalid JSON body",
              type: "invalid_request_error",
              code: "invalid_json",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const modelName = body.model ?? "zeroclaw-default";
      const stream = body.stream ?? false;

      // Non-streaming: collect everything and return a full JSON response
      if (!stream) {
        const chunks: string[] = [];
        let fullText = "";
        let finishReason: string | null = null;
        let toolCalls: unknown[] = [];
        let inputTokens = 0;
        let outputTokens = 0;

        const bridge = new ZCBridge(
          sessionId,
          zcToken,
          (chunk) => {
            chunks.push(chunk);
          },
          modelName,
        );

        const prompt = formatMessagesForZC(body.messages);
        await bridge.sendMessage(prompt);

        try {
          await bridge.waitForDone();
        } catch (err: any) {
          return new Response(
            JSON.stringify({
              error: {
                message: err.message,
                type: "proxy_error",
                code: "bridge_failed",
              },
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }
        // Parse accumulated SSE chunks to build the final response
        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                return new Response(JSON.stringify(parsed), {
                  status: 502,
                  headers: { "Content-Type": "application/json" },
                });
              }
              const delta = parsed.choices?.[0]?.delta;
              if (delta?.content) fullText += delta.content;
              if (delta?.tool_calls) toolCalls.push(...delta.tool_calls);
              if (parsed.choices?.[0]?.finish_reason)
                finishReason = parsed.choices[0].finish_reason;
              if (parsed.input_tokens) inputTokens = parsed.input_tokens;
              if (parsed.output_tokens) outputTokens = parsed.output_tokens;
            } catch {
              // ignore
            }
          }
        }

        const responseBody = {
          id: `chatcmpl-${sessionId}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: modelName,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: fullText || null,
                tool_calls: toolCalls.length ? toolCalls : undefined,
              },
              finish_reason: finishReason ?? "stop",
            },
          ],
          usage: {
            prompt_tokens: inputTokens || Math.ceil(prompt.length / 4),
            completion_tokens: outputTokens || Math.ceil(fullText.length / 4),
            total_tokens:
              (inputTokens || Math.ceil(prompt.length / 4)) +
              (outputTokens || Math.ceil(fullText.length / 4)),
          },
        };

        return new Response(JSON.stringify(responseBody), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Streaming response (SSE)
      server.timeout(req, 0)

      const streamController = new ReadableStream({
        start(controller) {
          const bridge = new ZCBridge(
            sessionId,
            zcToken,
            (chunk) => {
              controller.enqueue(new TextEncoder().encode(chunk));
            },
            modelName,
          );

          const prompt = formatMessagesForZC(body.messages);
          bridge.sendMessage(prompt).then(() => {
            bridge
              .waitForDone()
              .then(() => {
                controller.close();
              })
              .catch((err: Error) => {
                controller.enqueue(
                  new TextEncoder().encode(
                    sseEvent({
                      error: {
                        message: err.message,
                        type: "proxy_error",
                        code: "bridge_failed",
                      },
                    }),
                  ),
                );
                controller.close();
              });
          });

          // Abort handling
          req.signal.addEventListener("abort", () => {
            bridge.close();
            controller.close();
          });
        },
      });

      return new Response(streamController, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    },
  });
