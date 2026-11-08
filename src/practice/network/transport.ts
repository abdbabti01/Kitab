export type ReceiveBuffer = {
  next: number;
  delivered: string;
  pending: Record<number, string>;
  duplicates: number;
};
/** Fixed-MSS teaching model: whole segments are buffered until the byte gap closes. */
export function receiveBytes(
  buffer: ReceiveBuffer,
  sequence: number,
  data: string,
): ReceiveBuffer {
  const next = structuredClone(buffer);
  if (sequence < next.next || Object.hasOwn(next.pending, sequence)) {
    next.duplicates++;
    return next;
  }
  next.pending[sequence] = data;
  while (Object.hasOwn(next.pending, next.next)) {
    const chunk = next.pending[next.next];
    delete next.pending[next.next];
    if (!chunk) break;
    next.delivered += chunk;
    next.next += new TextEncoder().encode(chunk).length;
  }
  return next;
}
