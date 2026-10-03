// Embedding vectors travel as Float32Array in memory and as raw bytes in SQLite.
//
// Why bytes and not JSON? A 1536-dim vector is ~6 KB as Float32 bytes versus
// ~30 KB as JSON text, and decoding is a view over the buffer instead of a parse.
//
// Caveat worth knowing: Float32Array uses the CPU's byte order. We read and write
// on the same machine, so that is fine; a real cross-platform format (or pgvector)
// would fix the byte order explicitly.

export function vectorToBytes(vector: Float32Array | ArrayLike<number>): Uint8Array<ArrayBuffer> {
  // Allocate a fresh, 4-byte-aligned buffer of exactly 4 * n bytes and copy the
  // values in, so the Uint8Array view below covers precisely the vector. (Prisma's
  // Bytes type wants a Uint8Array backed by a plain ArrayBuffer, hence the explicit
  // allocation rather than Float32Array.from.)
  const buffer = new ArrayBuffer(vector.length * 4);
  const copy = new Float32Array(buffer);
  copy.set(vector);
  return new Uint8Array(buffer);
}

export function bytesToVector(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength % 4 !== 0) {
    throw new Error(`Corrupt vector: ${bytes.byteLength} bytes is not a multiple of 4`);
  }
  // Node may hand us a Buffer that is a *slice* of a larger pool; the slice can start
  // at any byte offset, but Float32Array views must start on a 4-byte boundary.
  if (bytes.byteOffset % 4 === 0) {
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }
  const aligned = new Uint8Array(bytes.byteLength);
  aligned.set(bytes);
  return new Float32Array(aligned.buffer);
}
