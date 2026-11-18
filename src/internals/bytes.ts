// A growable byte buffer.
//
// The byte payloads the compiler emits — machine code (`instructs`) and data
// (`internPool`) — are bytes, so they live one byte per slot in a Uint8Array
// instead of one 8-byte JSValue per slot in a `number[]`. The buffer doubles on
// demand and keeps its own `length`, so call sites still `push` and read
// `length` as before; only the few in-place rewrites (relocation patching) go
// through `store` / `load` rather than `buf[i]`.
export class Bytes {
  buf: Uint8Array
  length: number

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity)
    this.length = 0
  }

  push(...values: number[]): void {
    for (const value of values) {
      if (!Number.isInteger(value) || value < 0 || value > 0xff)
        throw new RangeError(`byte value out of range: ${value}`)
    }
    const end = this.length + values.length
    if (end > this.buf.length) this.reserve(end)
    for (let i = 0; i < values.length; i++) this.buf[this.length + i] = values[i]
    this.length = end
  }

  // Overwrite one already-emitted byte (absolute offset).
  store(index: number, value: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.length)
      throw new RangeError(`byte index out of range: ${index}`)
    if (!Number.isInteger(value) || value < 0 || value > 0xff)
      throw new RangeError(`byte value out of range: ${value}`)
    this.buf[index] = value
  }

  // Read one already-emitted byte.
  load(index: number): number { return this.buf[index] }

  // The emitted bytes, without the spare capacity.
  bytes(): Uint8Array { return this.buf.subarray(0, this.length) }

  private reserve(need: number): void {
    let capacity = this.buf.length || 1
    while (capacity < need) capacity *= 2
    const grown = new Uint8Array(capacity)
    grown.set(this.buf.subarray(0, this.length))
    this.buf = grown
  }
}
