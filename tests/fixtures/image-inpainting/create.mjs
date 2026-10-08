// 固定自制夹具（CC0）；astronaut.png 来源/授权记录见任务 1.6，不在脚本中联网。
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
const root = fileURLToPath(new URL('.', import.meta.url))

async function main() {
  const astronaut = await sharp(path.join(root, 'astronaut.png')).ensureAlpha().raw().toBuffer()
  const samples = [
    { name: 'wall-scratch', kind: 'wall', width: 512, height: 512, mask: (x, y) => x >= 242 && x < 248 && y > 120 && y < 390 },
    { name: 'brick-large', kind: 'brick', width: 512, height: 512, mask: (x, y) => x > 170 && x < 330 && y > 150 && y < 370 },
    { name: 'branches', kind: 'branches', width: 512, height: 512, mask: (x, y) => Math.abs(x - 256) < 30 && y > 170 && y < 340 },
    { name: 'text', kind: 'text', width: 512, height: 512, mask: (x, y) => x > 230 && x < 270 && y > 200 && y < 310 },
    { name: 'face-scratch', kind: 'photo', width: 512, height: 512, mask: (x, y) => x >= 244 && x < 250 && y > 118 && y < 159 },
    { name: 'hair-edge', kind: 'photo', width: 512, height: 512, mask: (x, y) => x > 164 && x < 215 && y > 45 && y < 104 },
    { name: 'transparent-wide', kind: 'wall', width: 2048, height: 1536, roi: { left: 640, top: 512, width: 512, height: 256 }, mask: (x, y) => x > 870 && x < 900 && y > 560 && y < 710 },
  ]
  const manifest = []
  for (const sample of samples) {
    const { width, height } = sample
    const original = Buffer.alloc(width * height * 4)
    const mask = Buffer.alloc(width * height)
    let text
    if (sample.kind === 'text') text = await sharp(Buffer.from('<svg width="512" height="512"><rect width="512" height="512" fill="white"/><text x="80" y="280" font-family="sans-serif" font-size="66" fill="black">HENJI AI</text></svg>')).ensureAlpha().raw().toBuffer()
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x
      let rgb = [160 + x % 512 / 20, 165 + y % 512 / 20, 170]
      if (sample.kind === 'brick') { const mortar = y % 44 < 4 || (x + (Math.floor(y / 44) % 2) * 44) % 88 < 4; rgb = mortar ? [180, 170, 150] : [130 + (x * 17 + y * 13) % 19, 65 + (x + y) % 10, 45] }
      if (sample.kind === 'branches') { const line = Math.abs(x - (y * 0.42 + 135)) < 4 || Math.abs(x - (-y * 0.7 + 420)) < 3 || Math.abs(x - 260) < 7; rgb = line ? [55, 42, 30] : [160, 195, 215] }
      if (sample.kind === 'photo') rgb = [...astronaut.subarray(i * 4, i * 4 + 3)]
      if (text) rgb = [...text.subarray(i * 4, i * 4 + 3)]
      original.set(rgb.map(Math.round), i * 4)
      original[i * 4 + 3] = sample.name === 'transparent-wide' ? (x % 256) : 255
      mask[i] = sample.mask(x, y) ? 255 : 0
    }
    const damaged = Buffer.from(original)
    for (let i = 0; i < mask.length; i++) if (mask[i]) damaged.set([255, 0, 255], i * 4)
    for (const [suffix, bytes] of [['original', original], ['source', damaged]]) await sharp(bytes, { raw: { width, height, channels: 4 } }).png().toFile(path.join(root, `${sample.name}-${suffix}.png`))
    await sharp(mask, { raw: { width, height, channels: 1 } }).toColourspace('b-w').png().toFile(path.join(root, `${sample.name}-mask.png`))
    manifest.push({ name: sample.name, source: `${sample.name}-source.png`, original: `${sample.name}-original.png`, mask: `${sample.name}-mask.png`, roi: sample.roi ?? { left: 0, top: 0, width, height } })
  }
  await fs.writeFile(path.join(root, 'fixtures.json'), JSON.stringify(manifest, null, 2) + '\n')
}
main().catch(error => { process.stderr.write(String(error)); process.exitCode = 1 })
