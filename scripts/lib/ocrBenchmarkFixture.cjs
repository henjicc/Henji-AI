const fs = require('node:fs/promises')
const path = require('node:path')
const { spawn } = require('node:child_process')
const sharp = require('sharp')
const { ffmpegPath } = require('./mediaBinaries.cjs')

/** Deterministic encoded workload, with known cursor coordinates and a new email after the 18-second scroll. */
async function createOcrBenchmarkFixture(root) {
  await fs.mkdir(root, { recursive: true })
  const file = name => path.join(root, name)
  for (const [name, shift, extra] of [['before', 0, ''], ['after', 180, 'new-scroll@example.net']]) {
    const lines = ['Screen recording privacy', 'demo@example.com', 'sk-testABCDEFGHIJKLMNOP1234', 'Normal text stays visible', '中文录屏隐私检查', extra]
    const svg = `<svg width="3840" height="2160"><rect width="3840" height="2160" fill="white"/>${lines.map((text, i) => `<text x="160" y="${280 + i * 140 - shift}" font-size="48" font-family="Microsoft YaHei" fill="black">${text}</text>`).join('')}</svg>`
    await sharp(Buffer.from(svg)).png().toFile(file(`${name}.png`))
  }
  await sharp(Buffer.from('<svg width="40" height="48"><path d="M2 2L2 39L12 28L21 46L28 42L19 25L37 25Z" fill="black" stroke="white" stroke-width="2"/></svg>')).png().toFile(file('cursor.png'))
  async function encode(args) {
    const child = spawn(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''; child.stderr.on('data', bytes => { error += bytes.toString().slice(0, 2000 - error.length) })
    await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error(`OCR fixture encode failed (${code}): ${error}`))) })
  }
  const codec = ['-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']
  await encode(['-loop', '1', '-framerate', '30', '-t', '18', '-i', file('before.png'), '-loop', '1', '-framerate', '30', '-t', '12', '-i', file('after.png'), '-loop', '1', '-i', file('cursor.png'), '-filter_complex', "[0:v][1:v]concat=n=2:v=1:a=0[base];[base][2:v]overlay=x='100+mod(t*180,3000)':y='1100+100*sin(t)':shortest=1,format=yuv420p", '-t', '30', ...codec, file('typical-30.mp4')])
  await encode(['-loop', '1', '-framerate', '30', '-i', file('before.png'), '-t', '3', ...codec, file('static-3.mp4')])
  for (const [source, output] of [['typical-30.mp4', 'typical-600.mp4'], ['static-3.mp4', 'static-600.mp4']]) await encode(['-stream_loop', '-1', '-i', file(source), '-t', '600', '-c', 'copy', file(output)])
  const cursor = Array.from({ length: 6000 }, (_, i) => { const t = (i / 10) % 30; return { monoUs: i * 100000, point: [100 + (t * 180) % 3000, 1100 + 100 * Math.sin(t)] } })
  await fs.writeFile(file('cursor.json'), JSON.stringify(cursor))
  return { video: file('typical-600.mp4'), cursor: file('cursor.json'), static: file('static-600.mp4') }
}
module.exports = { createOcrBenchmarkFixture }
if (require.main === module) createOcrBenchmarkFixture(path.resolve(process.argv[2] ?? '.tmp/ocr2')).then(value => console.log(JSON.stringify(value)), error => { console.error(error); process.exitCode = 1 })
