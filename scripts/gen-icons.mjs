/**
 * Generates the monochrome app icons as PNGs with no external deps: the mark
 * is a white equaliser on black, matching the brand. Run with `node
 * scripts/gen-icons.mjs` whenever the mark changes.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'public')
mkdirSync(outDir, { recursive: true })

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** White pill-shaped equaliser centred on a black (or transparent) canvas. */
function drawIcon(size, { markScale = 1, background = true } = {}) {
  const px = Buffer.alloc(size * size * 4)
  const put = (x, y, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = 255
    px[i + 1] = 255
    px[i + 2] = 255
    px[i + 3] = Math.round(a * 255)
  }
  if (background) {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        px[i + 3] = 255
      }
  }

  const bars = [0.45, 0.72, 1, 0.72, 0.45]
  const barW = size * 0.09 * markScale
  const gap = size * 0.045 * markScale
  const markH = size * 0.5 * markScale
  const totalW = bars.length * barW + (bars.length - 1) * gap
  const startX = (size - totalW) / 2
  const midY = size / 2
  const r = barW / 2

  bars.forEach((frac, idx) => {
    const h = markH * frac
    const x0 = startX + idx * (barW + gap)
    const y0 = midY - h / 2
    const x1 = x0 + barW
    const y1 = y0 + h
    const steps = 3 // supersample for smoother edges
    for (let sy = 0; sy < size * steps; sy++) {
      const y = sy / steps
      if (y < y0 || y >= y1) continue
      for (let sx = 0; sx < size * steps; sx++) {
        const x = sx / steps
        if (x < x0 || x >= x1) continue
        // pill: clamp the circle radius at the top/bottom ends
        const cx = Math.min(Math.max(x, x0 + r), x1 - r)
        const cy = Math.min(Math.max(y, y0 + r), y1 - r)
        const inside = (x - cx) ** 2 + (y - cy) ** 2 <= r * r
        // only round the caps, keep the middle straight
        const inCapZone = y < y0 + r || y > y1 - r
        if (!inCapZone || inside) put(Math.floor(x), Math.floor(y), 1 / (steps * steps))
      }
    }
  })
  return encodePng(size, px)
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { markScale: 0.62 }],
  ['apple-touch-icon.png', 180, {}],
  ['favicon-32.png', 32, { markScale: 1.15 }],
]

for (const [name, size, opts] of targets) {
  writeFileSync(join(outDir, name), drawIcon(size, opts))
  console.log(`[icons] wrote public/${name}`)
}
