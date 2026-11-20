// esptool verifies written flash with the ROM/stub MD5 command; Web Crypto has no MD5.
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]
const SINES = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0)

export function md5(bytes) {
  const length = bytes.length
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6)
  padded.set(bytes)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, (length << 3) >>> 0, true)
  view.setUint32(padded.length - 4, Math.floor(length / 2 ** 29), true)
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
  for (let offset = 0; offset < padded.length; offset += 64) {
    let [a, b, c, d] = state
    for (let i = 0; i < 64; i++) {
      const round = i >> 4
      let f, g
      if (round === 0) { f = (b & c) | (~b & d); g = i }
      else if (round === 1) { f = (d & b) | (~d & c); g = (5 * i + 1) & 15 }
      else if (round === 2) { f = b ^ c ^ d; g = (3 * i + 5) & 15 }
      else { f = c ^ (b | ~d); g = (7 * i) & 15 }
      const x = (a + f + SINES[i] + view.getUint32(offset + g * 4, true)) | 0
      const shift = SHIFTS[round * 4 + (i & 3)]
      a = d; d = c; c = b
      b = (b + ((x << shift) | (x >>> (32 - shift)))) | 0
    }
    state[0] = (state[0] + a) | 0
    state[1] = (state[1] + b) | 0
    state[2] = (state[2] + c) | 0
    state[3] = (state[3] + d) | 0
  }
  const out = new DataView(new ArrayBuffer(16))
  state.forEach((word, i) => out.setUint32(i * 4, word >>> 0, true))
  return Array.from(new Uint8Array(out.buffer), byte => byte.toString(16).padStart(2, '0')).join('')
}
