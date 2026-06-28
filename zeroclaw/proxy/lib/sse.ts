import { Buffer } from "buffer";

// Maximum safe byte length for a single `data:` line emitted by this proxy.
// SSE parsers (and Bun's fetch reader used by OpenWebUI) commonly enforce a
// per-line limit of 128 KiB. We stay well below that at 64 KiB.
const MAX_DATA_LINE_BYTES = 65536;

// Hard cap on how large a JSON payload we will try to chunk into SSE events.
// Anything larger is dropped with an error event rather than allowing an
// attacker to force unbounded CPU/memory work on the proxy.
const MAX_CHUNKABLE_PAYLOAD_BYTES = 4 * 1024 * 1024;

// Characters that break SSE framing when emitted inside an `id:` field.
const SSE_ID_FORBIDDEN_RE = /[\r\n\0]/g;

/**
 * Serialize a value into one or more SSE events.
 *
 * If the JSON payload fits in a single `data:` line (under 64 KiB), a normal
 * SSE event is emitted. If it does not, the payload is emitted as **multiple
 * separate SSE events** (one event per chunk). Each event carries a slice of
 * the JSON string in its `data:` field. This avoids producing any single line
 * longer than 64 KiB, while keeping the emitted bytes valid JSON once the
 * client concatenates the events' `data` values in order.
 *
 * If the payload is larger than `MAX_CHUNKABLE_PAYLOAD_BYTES`, an SSE error
 * event is returned instead so the client sees a clear failure.
 */
export function sseEvent(data: unknown, id?: string): string {
  let payload: string;
  try {
    payload = JSON.stringify(data);
  } catch {
    payload = JSON.stringify({ error: "Failed to serialize SSE payload" });
  }

  if (Buffer.byteLength(payload, "utf8") > MAX_CHUNKABLE_PAYLOAD_BYTES) {
    return sseEvent(
      { error: "SSE payload exceeds maximum chunkable size" },
      id,
    );
  }

  const safeId = id?.replace(SSE_ID_FORBIDDEN_RE, "") ?? undefined;
  const prefix = "data: ";
  const prefixBytes = Buffer.byteLength(prefix, "utf8");
  const available = MAX_DATA_LINE_BYTES - prefixBytes;

  if (Buffer.byteLength(payload, "utf8") <= available) {
    return formatSingleEvent(payload, safeId, prefix);
  }

  // Encode once and slice by byte offsets. This gives O(n) chunking with no
  // repeated UTF-8 re-encoding. Each chunk is a valid UTF-8 substring of the
  // original JSON, so concatenating event data fields reconstructs the payload.
  const bytes = Buffer.from(payload, "utf8");
  let out = "";
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + available);
    // Do not slice in the middle of a multi-byte UTF-8 sequence.
    while (end > start && ((bytes[end] ?? 0) & 0xc0) === 0x80) {
      end--;
    }
    if (end === start) {
      // A single code point is larger than the budget; advance one byte so
      // we always make progress. This is pathological (4-byte char > 64 KiB
      // is impossible), but the guard keeps the loop terminating.
      end = start + 1;
    }
    const slice = bytes.toString("utf8", start, end);

    if (safeId) out += `id: ${safeId}\n`;
    out += `${prefix}${slice}\n\n`;
    start = end;
  }
  return out;
}

function formatSingleEvent(payload: string, safeId: string | undefined, prefix: string): string {
  let out = "";
  if (safeId) out += `id: ${safeId}\n`;
  out += `${prefix}${payload}\n\n`;
  return out;
}
