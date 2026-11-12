// 把一份剪完的口播文档做成粗剪评估台的回归用例：只留词块、时间、最终保留与否、最终剪切、参考稿与声音证据，
// 去掉素材路径、指纹、效果链等无关内容。只读用户数据，结果写到 fixtures/ 下。
//
// 用法：node scripts/audio-edit-rough-cut-eval/build-fixture.cjs --doc <口播.hjaud> --name <用例名>
//         (--audio <录音文件> | --energy <能量分析.json>) [--breaths <呼吸分析缓存.json>] [--draft] [--note <说明>]
// --draft：这份不是定稿（里面还留着没处理完的地方），只作参考，不计入验收线。
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const { gzipSync } = require('node:zlib')

const args = process.argv.slice(2)
const value = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined }
const docPath = value('--doc'), name = value('--name')
if (!docPath || !name || !/^[\w-]+$/.test(name) || (!value('--audio') && !value('--energy'))) {
  throw new Error('用法：--doc <口播.hjaud> --name <英文用例名> (--audio <录音> | --energy <json>) [--breaths <json>] [--draft] [--note <说明>]')
}

/** 与主进程 decodeSpeechEnergy 相同的滤镜与门限：16 kHz、10 毫秒一格的全频与 2.5 kHz 以上电平。 */
function analyzeEnergy(audioPath) {
  const stats = (band) => `astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level${band === 'wide' ? '+Number_of_samples' : ''},ametadata@${band}=print${band === 'wide' ? '' : ':key=lavfi.astats.Overall.RMS_level'}`
  const filter = `aresample=16000,asetpts=N/SR/TB,asetnsamples=n=160:p=0,${stats('wide')},highpass=f=2500,${stats('high')}`
  const run = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-hide_banner', '-nostats', '-threads', '2', '-i', audioPath, '-map', '0:a:0', '-af', filter, '-vn', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 30 })
  if (run.status !== 0) throw new Error(`ffmpeg 分析失败：${run.stderr.slice(-400)}`)
  const wide = [], high = []
  for (const line of run.stderr.split(/\r?\n/)) {
    const match = /\[ametadata@(wide|high)\s+@[^\]]*\]\s+lavfi\.astats\.Overall\.RMS_level=(-?inf|[-\d.e+]+)\s*$/i.exec(line)
    if (match) (match[1] === 'wide' ? wide : high).push(match[2].toLowerCase() === '-inf' ? -120 : Number(match[2]))
  }
  if (!wide.length || wide.length !== high.length) throw new Error('没有取得完整的全频与高频电平')
  const threshold = (values, below, floor) => {
    const bins = new Uint32Array(481); let count = 0
    for (const db of values) if (db > -120 && Number.isFinite(db)) { bins[Math.max(0, Math.min(480, Math.round((db + 120) * 4)))]++; count++ }
    let remaining = Math.ceil(count * 0.8)
    for (let index = 0; index < bins.length; index++) { remaining -= bins[index]; if (remaining <= 0) return Math.max(floor, index / 4 - 120 - below) }
    return floor
  }
  const thresholdDb = threshold(wide, 22, -80), highThresholdDb = threshold(high, 16, -110)
  const pauses = []; let start, end = 0
  const flush = () => { if (start !== undefined && end - start >= 100 - 0.01) pauses.push({ startMs: start, endMs: end, cutMs: (start + end) / 2 }); start = undefined }
  wide.forEach((db, index) => {
    const quiet = db < thresholdDb && high[index] < highThresholdDb, at = index * 10
    if (!quiet || at > end + 0.01) flush()
    if (quiet) { start ??= at; end = at + 10 }
  })
  flush()
  const level = (db) => Math.max(-120, Math.min(0, Math.round(db * 10) / 10))
  return { resolutionMs: 10, thresholdDb, highThresholdDb, pauses, levels: { wideDb: wide.map(level), highDb: high.map(level) } }
}

const pack = (values) => Buffer.from(Int16Array.from(values, (db) => Math.round(db * 10)).buffer).toString('base64')
const content = JSON.parse(readFileSync(docPath, 'utf8')).content
const energy = value('--energy') ? JSON.parse(readFileSync(value('--energy'), 'utf8')) : analyzeEnergy(value('--audio'))
const breaths = value('--breaths') ? JSON.parse(readFileSync(value('--breaths'), 'utf8')).breaths : []
const origin = (cut) => cut.reason === 'manual' ? (/^manual:(gap|breath):/.test(cut.id) ? 'adopted' : 'manual') : cut.id.split(':')[0]
const fixture = {
  version: 1, name, gold: !args.includes('--draft'), note: value('--note') ?? '',
  sampleRate: content.source.sampleRate, channels: content.source.channels, durationFrames: content.source.durationFrames,
  referenceScript: content.referenceScript ?? '',
  blocks: content.transcript.filter((block) => block.granularity === 'word').sort((a, b) => a.startFrame - b.startFrame)
    .map((block, index) => ({ id: `w${index}`, text: block.text, startFrame: block.startFrame, endFrame: block.endFrame, kept: block.included })),
  // origin：这一刀最初是谁下的（retake/silence/breath/gap 是算法，adopted 是用户拖过边缘的自动剪切，manual 是用户从零画的）
  finalCuts: (content.cuts ?? []).map((cut) => ({ origin: origin(cut), startFrame: cut.startFrame, endFrame: cut.endFrame, mute: cut.mode === 'mute', enabled: cut.enabled })),
  energy: { thresholdDb: energy.thresholdDb, highThresholdDb: energy.highThresholdDb, pauses: energy.pauses, wideDb10: pack(energy.levels.wideDb), highDb10: pack(energy.levels.highDb) },
  breaths: breaths.map((breath) => ({ startMs: breath.startMs, endMs: breath.endMs, peak: Math.round(breath.peak * 1000) / 1000 })),
}
const target = join(__dirname, 'fixtures')
mkdirSync(target, { recursive: true })
const bytes = gzipSync(JSON.stringify(fixture), { level: 9 })
writeFileSync(join(target, `${name}.json.gz`), bytes)
console.log(`${name}.json.gz：${fixture.blocks.length} 个词块，${fixture.finalCuts.length} 条剪切，${energy.pauses.length} 段声音低谷，${fixture.breaths.length} 口呼吸，${(bytes.length / 1024).toFixed(0)} KB`)
