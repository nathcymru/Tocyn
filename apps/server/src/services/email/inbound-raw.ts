/** A bounded preparation primitive. Admission must precede calling this reader. */
export const MAX_INBOUND_RAW_BYTES = 2 * 1024 * 1024;
export const MAX_INBOUND_RAW_CHUNKS = 32768;

export async function readBoundedInboundRaw(stream: ReadableStream<Uint8Array>, expectedBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > MAX_INBOUND_RAW_BYTES) {
    throw new Error('Invalid inbound message size');
  }
  const reader = stream.getReader();
  try {
    const result = new Uint8Array(expectedBytes);
    let received = 0, chunks = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (++chunks > MAX_INBOUND_RAW_CHUNKS || !(value instanceof Uint8Array)
        || value.byteLength > expectedBytes - received) throw new Error('Inbound message exceeds admitted bounds');
      result.set(value,received);
      received += value.byteLength;
    }
    if (received !== expectedBytes) throw new Error('Inbound message ended before its declared size');
    return result;
  } catch (error) {
    // Cancellation failure cannot replace the original validation/read failure.
    try { await reader.cancel(error); } catch { /* The original error is authoritative. */ }
    throw error;
  } finally { reader.releaseLock(); }
}
