export function sseEvent(data: unknown, id?: string): string {
  let out = "";
  if (id) out += `id: ${id}\n`;
  out += `data: ${JSON.stringify(data)}\n\n`;
  return out;
}