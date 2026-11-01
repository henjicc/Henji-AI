import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// 上游测试字体只落专项临时目录；固定提交和字节摘要使能力探针可重现，不成为应用依赖。
const sources = [
  { id: 'morx', root: 'harfbuzz/harfbuzz/0ba555a3d4f00a5d2909b0cf8720e04b8fe83ff0/test/shape/data/in-house/fonts', file: 'MORXTwentyeight.ttf', text: 'AxEyDyy', tables: ['morx'], expectedAdvances: [1394, 529, 510, 510, 510] },
  { id: 'kerx', root: 'harfbuzz/harfbuzz/0ba555a3d4f00a5d2909b0cf8720e04b8fe83ff0/test/shape/data/in-house/fonts', file: '9f0def61bfa49ffb44ba45c8703eee567c5bb816.ttf', text: 'AB', tables: ['kerx'], expectedAdvances: [560, 560] },
  { id: 'sbix', root: 'googlefonts/color-fonts/0046ea4c3b69e9fbbe464c2594816894e3aa5e4b/fonts', file: 'twemoji_smiley-sbix.ttf', text: '😀', tables: ['sbix'] },
  { id: 'cbdt', root: 'googlefonts/noto-emoji/99701e07d3d1fe1bdbcdb14964547f0fd592966f/2D/fonts', file: 'NotoColorEmoji.ttf', text: '😀', tables: ['CBDT', 'CBLC'] },
]
const out = path.resolve('.tmp/text-layout-acceptance'), result = []
fs.mkdirSync(out, { recursive: true })
for (const source of sources) {
  const url = `https://raw.githubusercontent.com/${source.root}/${source.file}`, file = `format-${source.id}.ttf`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  fs.writeFileSync(path.join(out, file), bytes)
  result.push({ ...source, url, file, hash: crypto.createHash('sha256').update(bytes).digest('hex') })
}
fs.writeFileSync(path.join(out, 'format-fonts.json'), JSON.stringify(result, null, 2))
console.log(result.map(({ id, hash }) => ({ id, hash })))
