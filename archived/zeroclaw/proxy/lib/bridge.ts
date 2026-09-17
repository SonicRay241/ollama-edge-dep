import { ZC_AGENT, ZC_WS_URL } from "./constants";
import { truncateString } from "./message-formatter";
import { sseEvent } from "./sse";
import type { ZCFrame } from "./types";

export class ZCBridge {
  private ws: WebSocket;
  private buffer = "";
  private isThinking = false;
  private toolCallBuffer: { name: string; args: string } | null = null;
  private resolveDone!: (value: void) => void;
  private rejectDone!: (reason: Error) => void;
  private donePromise: Promise<void>;
  private aborted = false;

  private resolveConnected!: (value: void) => void;
  private connectedPromise: Promise<void>;

  private cancelResolve!: (value: void) => void;
  private cancelPromise: Promise<void> | null = null;

  constructor(
    private sessionId: string,
    private bearerToken: string,
    private onSSE: (chunk: string) => void,
    private modelName: string,
  ) {
    this.connectedPromise = new Promise((res) => {
      this.resolveConnected = res;
    });

    this.donePromise = new Promise((res, rej) => {
      this.resolveDone = res;
      this.rejectDone = rej;
    });

    const url = new URL(ZC_WS_URL);
    url.searchParams.set("token", this.bearerToken);
    url.searchParams.set("session_id", this.sessionId);
    url.searchParams.set("agent", ZC_AGENT);

    this.ws = new WebSocket(url.toString(), [
      "zeroclaw.v1",
      `bearer.${this.bearerToken}`,
    ]);

    this.ws.onopen = () => {
      this.resolveConnected();
    };

    this.ws.onmessage = (evt) => {
      this.handleFrame(evt.data as string);
    };

    this.ws.onerror = (err) => {
      this.rejectDone(new Error(`WebSocket error: ${err}`));
    };

    this.ws.onclose = (event) => {
      if (!this.aborted) {
        // If we haven't sent a done event yet, send one now
        this.flushFinalAssistantMessage();
        this.resolveDone();
      }
      if (this.cancelPromise) {
        this.cancelResolve();
      }
      console.log(
        `Connection closed. Code: ${event.code}, Reason: ${event.reason || "None"}`,
      );
    };
  }

  private handleFrame(raw: string) {
    let frame: ZCFrame;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    switch (frame.type) {
      case "session_start":
        // Ignore — connection established
        this.buffer += "\n"
        break;

      case "chunk": {
        const text = (frame.content as string) ?? "";
        let msg = ""
        if (this.isThinking) {
          msg += "</think>\n"
          this.isThinking = false
        }
        msg += text
        this.buffer += msg;
        // Stream as OpenAI delta
        this.onSSE(
          sseEvent({
            id: `chatcmpl-${this.sessionId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: this.modelName,
            choices: [
              {
                index: 0,
                delta: { content: msg },
                finish_reason: null,
              },
            ],
          }),
        );
        break;
      }

      case "thinking": {
        const text = (frame.content as string) ?? "";
        let msg = ""
        if (!this.isThinking) {
          msg += "<think>"
          this.isThinking = true
        }
        msg += text

        this.buffer += msg

        this.onSSE(
          sseEvent({
            id: `chatcmpl-${this.sessionId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: this.modelName,
            choices: [
              {
                index: 0,
                delta: { content: msg },
                finish_reason: null,
              },
            ],
          }),
        );
        
        break;
      }

      case "tool_call": {
        const id = (frame.id as string) ?? ""
        const name = (frame.name as string) ?? "";
        const args = JSON.stringify(frame.args ?? {});
        this.toolCallBuffer = { name, args };

        const escapedArgs = Bun.escapeHTML(args)
        const escapedId = Bun.escapeHTML(id)

        // let toolMsg = ""

        // if (this.buffer.length > 0 && this.buffer[this.buffer.length - 1] != ">") {
        //   toolMsg += "\n"
        // }

        // toolMsg += `<details type="tool_calls" done="false" id="${escapedId}" name="${name}" arguments="${escapedArgs}">
        // </details>`

        // // const toolMsg = `\n🔧 \`${name}\`: \`${truncateString(args, 50)}\``;
        // this.buffer += toolMsg;

        // this.onSSE(
        //   sseEvent({
        //     id: `chatcmpl-${this.sessionId}`,
        //     object: "chat.completion.chunk",
        //     created: Math.floor(Date.now() / 1000),
        //     model: this.modelName,
        //     choices: [
        //       {
        //         index: 0,
        //         delta: { content: toolMsg },
        //         finish_reason: null,
        //       },
        //     ],
        //   }),
        // );

        // Do NOT emit to OpenAI client — handled by OpenClaw internally
        break;
      }

      case "tool_result": {
        const id = (frame.id as string) ?? ""
        const name = (frame.name as string) ?? this.toolCallBuffer?.name ?? "tool";
        const output = (frame.output as string) ?? "";

        const escapedOutput = Bun.escapeHTML(output)
        const escapedArgs = Bun.escapeHTML(this.toolCallBuffer?.args || "{}")
        const escapedId = Bun.escapeHTML(id)

        let toolMsg = ""

        if (this.buffer.length > 0 && this.buffer[this.buffer.length - 1] != ">") {
          toolMsg += "\n"
        }

        toolMsg += `<details type="tool_calls" done="true" id="${escapedId}" name="${this.toolCallBuffer?.name || name}" arguments="${escapedArgs}">
        ${escapedOutput}
        </details>`

        this.buffer += toolMsg;
        this.onSSE(
          sseEvent({
            id: `chatcmpl-${this.sessionId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: this.modelName,
            choices: [
              {
                index: 0,
                delta: { content: toolMsg },
                finish_reason: null,
              },
            ],
          }),
        );
        this.toolCallBuffer = null;
        break;
      }

      case "done": {
        this.flushFinalAssistantMessage();
        this.onSSE(
          sseEvent({
            id: `chatcmpl-${this.sessionId}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: this.modelName,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          }),
        );
        this.onSSE(sseEvent("[DONE]"));
        this.aborted = true;
        this.resolveDone();
        this.ws.close();
        break;
      }

      case "turn_complete": {
        if (this.cancelPromise) {
          this.cancelResolve();
        }
        break;
      }

      case "error": {
        const msg = (frame.message as string) ?? "Unknown ZeroClaw error";
        const code = (frame.code as string) ?? "ZC_ERROR";
        this.onSSE(
          sseEvent({
            error: { message: msg, type: code, param: null, code },
          }),
        );
        this.rejectDone(new Error(`${code}: ${msg}`));
        this.ws.close();
        break;
      }

      case "approval_request": {
        // Auto-approve all tool calls for now (no human in the loop for API usage)
        this.ws.send(
          JSON.stringify({
            type: "approval_response",
            request_id: frame.request_id,
            decision: "always",
          }),
        );
        break;
      }

      case "connected":
      case "ping":
      case "pong":
        // No-op
        break;

      default:
        console.log("Unhandled ZC frame:", frame.type);
    }
  }

  private flushFinalAssistantMessage() {
    // If there was buffered content and no explicit done, make sure we emit it
    if (this.buffer && !this.aborted) {
      this.onSSE(
        sseEvent({
          id: `chatcmpl-${this.sessionId}`,
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: this.modelName,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        }),
      );
    }
  }
  async sendMessage(content: string): Promise<void> {
    await this.connectedPromise;
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "message", content }));
    } else {
      throw new Error("WebSocket not open");
    }
  }

  async waitForDone(): Promise<void> {
    return this.donePromise;
  }

  async cancel(): Promise<void> {
    if (this.cancelPromise) {
      return this.cancelPromise;
    }

    this.cancelPromise = new Promise((res) => {
      this.cancelResolve = res;
    });

    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "cancel" }));
      // If the daemon doesn't acknowledge within 5 seconds, close anyway.
      setTimeout(() => {
        this.cancelResolve();
      }, 5000);
      await this.cancelPromise;
    }

    this.aborted = true;
    this.ws.close();
  }
}
