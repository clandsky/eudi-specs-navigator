// Minimal CBOR (RFC 8949) for the mdoc examples: encodes what ISO/IEC 18013-5 structures need (unsigned and negative
// integers, byte and text strings, arrays, maps with any key type, tags, false/true/null) and decodes the same subset
// plus floats. Runs in the browser (the object view decodes DeviceResponses) and in the example build.

/** A tagged data item, e.g. tag 24 (encoded CBOR data item) or tag 1004 (full-date). */
export class Tagged {
  constructor(
    public tag: number,
    public value: unknown,
  ) {}
}

function head(major: number, n: number, out: number[]) {
  const m = major << 5
  if (n < 24) out.push(m | n)
  else if (n < 0x100) out.push(m | 24, n)
  else if (n < 0x10000) out.push(m | 25, n >> 8, n & 0xff)
  else if (n < 0x100000000) out.push(m | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff)
  else {
    const hi = Math.floor(n / 0x100000000)
    out.push(m | 27, (hi >>> 24) & 0xff, (hi >> 16) & 0xff, (hi >> 8) & 0xff, hi & 0xff)
    const lo = n % 0x100000000
    out.push((lo >>> 24) & 0xff, (lo >> 16) & 0xff, (lo >> 8) & 0xff, lo & 0xff)
  }
}

function enc(v: unknown, out: number[]) {
  if (v === false) out.push(0xf4)
  else if (v === true) out.push(0xf5)
  else if (v === null || v === undefined) out.push(0xf6)
  else if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`cbor: only integers are supported, got ${v}`)
    if (v >= 0) head(0, v, out)
    else head(1, -1 - v, out)
  } else if (typeof v === 'string') {
    const b = new TextEncoder().encode(v)
    head(3, b.length, out)
    for (const x of b) out.push(x)
  } else if (v instanceof Uint8Array) {
    head(2, v.length, out)
    for (const x of v) out.push(x)
  } else if (v instanceof Tagged) {
    head(6, v.tag, out)
    enc(v.value, out)
  } else if (Array.isArray(v)) {
    head(4, v.length, out)
    for (const x of v) enc(x, out)
  } else if (v instanceof Map) {
    head(5, v.size, out)
    for (const [k, x] of v) {
      enc(k, out)
      enc(x, out)
    }
  } else if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    head(5, entries.length, out)
    for (const [k, x] of entries) {
      enc(k, out)
      enc(x, out)
    }
  } else throw new Error(`cbor: cannot encode ${typeof v}`)
}

/** Encodes in the given order (map entries in insertion order); plain objects become maps with text keys. */
export function encodeCbor(v: unknown): Uint8Array {
  const out: number[] = []
  enc(v, out)
  return Uint8Array.from(out)
}

/** Decodes one data item. Maps become `Map`s (keys keep their CBOR type), byte strings `Uint8Array`s. */
export function decodeCbor(bytes: Uint8Array): unknown {
  let i = 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const need = (n: number) => {
    if (i + n > bytes.length) throw new Error('cbor: unexpected end of input')
  }
  const arg = (info: number): number => {
    if (info < 24) return info
    const len = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0
    if (!len) throw new Error(`cbor: unsupported additional information ${info}`)
    need(len)
    let n = 0
    for (let k = 0; k < len; k++) n = n * 256 + bytes[i + k]!
    i += len
    return n
  }
  const item = (): unknown => {
    need(1)
    const ib = bytes[i++]!
    const major = ib >> 5
    const info = ib & 0x1f
    if (major === 7) {
      if (info === 20) return false
      if (info === 21) return true
      if (info === 22) return null
      if (info === 23) return undefined
      if (info === 25) {
        need(2)
        const h = view.getUint16(i)
        i += 2
        const e = (h >> 10) & 0x1f
        const f = h & 0x3ff
        const s = h & 0x8000 ? -1 : 1
        return s * (e === 0 ? f * 2 ** -24 : e === 31 ? (f ? NaN : Infinity) : (1 + f / 1024) * 2 ** (e - 15))
      }
      if (info === 26) {
        need(4)
        const x = view.getFloat32(i)
        i += 4
        return x
      }
      if (info === 27) {
        need(8)
        const x = view.getFloat64(i)
        i += 8
        return x
      }
      throw new Error(`cbor: unsupported simple value ${info}`)
    }
    if (info === 31) throw new Error('cbor: indefinite lengths are not supported')
    const n = arg(info)
    switch (major) {
      case 0:
        return n
      case 1:
        return -1 - n
      case 2: {
        need(n)
        const b = bytes.slice(i, i + n)
        i += n
        return b
      }
      case 3: {
        need(n)
        const s = new TextDecoder().decode(bytes.subarray(i, i + n))
        i += n
        return s
      }
      case 4:
        return Array.from({ length: n }, () => item())
      case 5: {
        const m = new Map<unknown, unknown>()
        for (let k = 0; k < n; k++) {
          const key = item()
          m.set(key, item())
        }
        return m
      }
      default:
        return new Tagged(n, item())
    }
  }
  const v = item()
  if (i !== bytes.length) throw new Error(`cbor: ${bytes.length - i} trailing byte(s)`)
  return v
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export function fromHex(h: string): Uint8Array {
  if (!/^([0-9a-f]{2})*$/i.test(h)) throw new Error(`not a hex string: ${h}`)
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16))
}

export function fromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Uint8Array.from(atob((s + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
}
