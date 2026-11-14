// 列出一段录制的缩放段，并按帧求镜头视野，用来对比两版算法。用法（仓库根目录）：
//   node docs/task/录屏自动缩放/缩放段对比.cjs <recordingZoom.ts 路径> <录制会话目录> [regions.json] [输出.json]
// 不给 regions.json 时用该版本的自动生成结果；给了就用里面的区间（比如原剪辑里旧版生成的那一组）。
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const [modulePath, sessionDir, regionsPath, outPath] = process.argv.slice(2)
const bundle = path.join(os.tmpdir(), `recording-zoom-${process.pid}.cjs`)
require('esbuild').buildSync({ entryPoints: [path.resolve(modulePath)], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' })
const zoom = require(bundle); fs.rmSync(bundle)
const events = fs.readdirSync(sessionDir).filter(name => /^\d+-.*\.capture\.json$/.test(name)).sort().flatMap(name => JSON.parse(fs.readFileSync(path.join(sessionDir, name), 'utf8')).entries)
const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, fs.readdirSync(sessionDir).find(name => name.endsWith('.capture.json') && !/^\d+-/.test(name))), 'utf8'))
const size = { width: Number(process.env.ZOOM_SOURCE_WIDTH || 3840), height: Number(process.env.ZOOM_SOURCE_HEIGHT || 2160) }
const recordingStartUs = Number(process.env.ZOOM_RECORDING_START_US || 987765)
const durationUs = Number(process.env.ZOOM_DURATION_US || 71_100_000)
void meta
let id = 0
const regions = regionsPath && regionsPath !== '-' ? JSON.parse(fs.readFileSync(regionsPath, 'utf8')) : zoom.suggestRecordingZoomRegions(events, { recordingStartUs, durationUs, size, createId: () => `auto-${++id}` })
const params = { connect: true, transition: 'smooth' }
const pointer = sourceUs => zoom.recordingZoomPointerFromEvents(events, sourceUs + recordingStartUs, size)
const seconds = us => (us / 1e6).toFixed(2)
for (const region of regions) console.log(`${seconds(region.startUs)}–${seconds(region.endUs)} 秒  第 ${region.depth} 档  ${region.focus === 'cursor' ? '跟随鼠标' : `固定 (${region.focus.x}, ${region.focus.y})`}`)
// 每 0.1 秒求一次视野；镜头“动了多少”= 视野中心与倍数的累计变化（归一化），越小越稳。
const samples = []; let travel = 0; let zoomChanges = 0; let previous
for (let us = 0; us <= durationUs; us += 100_000) {
  const view = zoom.evaluateRecordingZoom(regions, us, params, pointer)
  if (previous) { travel += Math.hypot(view.centerX - previous.centerX, view.centerY - previous.centerY); zoomChanges += Math.abs(Math.log(view.scale / previous.scale)) }
  samples.push({ us, ...view }); previous = view
}
console.log(`镜头中心累计移动 ${travel.toFixed(3)}（画面宽高为 1），倍数累计变化 ${zoomChanges.toFixed(3)}（对数）`)
if (outPath) fs.writeFileSync(outPath, JSON.stringify({ regions, samples }, null, 1))
