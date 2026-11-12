#!/usr/bin/env node
/**
 * 录屏长时间写盘压测（不依赖应用，不录真实画面）。
 *
 * 用法：node "tickets/46-正式使用链路/证据/recording-write-stress.cjs" [--old-minutes 10,20] [--new-minutes 15,30,60,120]
 *
 * - 旧做法：每封一页事件、每封一段声音都把整份录制会话文档按正式 schema 校验后整份写盘（与改动前的 session-document 一致）。
 * - 新做法：事件页只记内存索引；每段声音追加一行 tracks.journal 并 datasync；停止时整份文档写一次。
 * - 事件页本身（每页 256 条，120 Hz 光标）两种做法都一样写，新做法下用正式 CaptureLogCollector 实写，记录写盘积压峰值。
 *
 * 数据形状与真实录制一致：每页约 2.1 秒；麦克风与系统声各每 5 秒一段，每段两个时钟锚点。
 */
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const ROOT = path.resolve(__dirname, '../../..')
const { loadTypeScript } = require(path.join(ROOT, 'scripts/check-persistence-compat.cjs'))
const { recordingDocumentSchema, createRecordingDocument } = loadTypeScript('src/core/screenRecording/document.ts')
const { recordingTrackJournalLine } = loadTypeScript('src/core/screenRecording/trackJournal.ts')
const { CaptureLogCollector } = loadTypeScript('src/core/captureLog/collector.ts')

const args = process.argv.slice(2)
const list = (flag, fallback) => { const index = args.indexOf(flag); return (index >= 0 ? args[index + 1] : fallback).split(',').map(Number) }
const oldMinutes = list('--old-minutes', '10,20'), newMinutes = list('--new-minutes', '15,30,60,120')
const PAGE_US = 2_133_333, SEGMENT_US = 5_000_000

const anchor = (monoUs, segment, audioSample) => ({ monoUs, audioSample, audioSegmentRef: segment, audioRate: 48000, presentedFrame: null, requestedFrame: null, sequenceRef: null, visitRef: null, playbackDirection: 0, playbackRate: 1, playing: false, epoch: 0, uncertaintyUs: 1200 })
function segment(start) {
  const id = randomUUID()
  return { id, file: `${id}.wav`, monoSpanUs: [start, start + SEGMENT_US], sampleRate: 48000, channels: 1, units: 240000, latencyCompensationUs: 0, sourceClockOffsetUs: start, anchors: [anchor(start, id, 0), anchor(start + SEGMENT_US, id, 240000)] }
}
/** 录制期间按时间顺序发生的封页与封段。 */
function* timeline(minutes) {
  const endUs = minutes * 60_000_000
  let page = 0, seg = 0
  for (;;) {
    const pageAt = (page + 1) * PAGE_US, segAt = (seg + 1) * SEGMENT_US
    if (Math.min(pageAt, segAt) > endUs) return
    if (pageAt <= segAt) { yield { kind: 'page', index: page++ } } else { yield { kind: 'segment', start: seg++ * SEGMENT_US } }
  }
}
async function writeDurable(file, text, flag = 'w') {
  const handle = await fsp.open(file, flag)
  try { await handle.write(text); await handle.datasync() } finally { await handle.close() }
}

async function oldModel(directory, minutes) {
  const content = createRecordingDocument()
  Object.assign(content, { sessionId: randomUUID(), originUs: 1, status: 'recording', devices: { microphone: {}, systemAudio: true } })
  content.tracks = { version: 1, sessionId: content.sessionId, originUs: 1, tracks: [{ kind: 'microphone', segments: [], gaps: [], warnings: [] }, { kind: 'systemAudio', segments: [], gaps: [], warnings: [] }] }
  const file = path.join(directory, 'old.hjrec')
  let bytes = 0, maxMs = 0, saves = 0
  const started = performance.now()
  // 与改动前一致：整份校验、读回比对、整份写盘。
  const save = async () => {
    const at = performance.now()
    const text = JSON.stringify(recordingDocumentSchema.parse(structuredClone(content)))
    if (fs.existsSync(file)) recordingDocumentSchema.parse(JSON.parse(await fsp.readFile(file, 'utf8')))
    await writeDurable(`${file}.tmp`, text); await fsp.rename(`${file}.tmp`, file)
    bytes += Buffer.byteLength(text); saves++; maxMs = Math.max(maxMs, performance.now() - at)
  }
  for (const step of timeline(minutes)) {
    if (step.kind === 'page') { content.eventPages.push({ path: path.join(directory, `${String(step.index * 256).padStart(16, '0')}-${'a'.repeat(64)}.capture.json`), firstSequence: step.index * 256, lastSequence: step.index * 256 + 255 }); await save(); continue }
    // 每一路声音封段都单独存一次（改动前每段封口各发一次全轨快照）。
    for (const track of content.tracks.tracks) {
      const value = segment(step.start); track.segments.push(value)
      content.media.push({ id: value.id, kind: track.kind, path: path.join(directory, value.file), monoUs: step.start, durationUs: SEGMENT_US })
      await save()
    }
  }
  return { saves, bytes, maxMs, elapsedMs: performance.now() - started, finalBytes: fs.statSync(file).size }
}

async function newModel(directory, minutes) {
  const sessionId = randomUUID()
  const content = createRecordingDocument()
  Object.assign(content, { sessionId, originUs: 1, status: 'recording', devices: { microphone: {}, systemAudio: true } })
  const pages = [], segments = { microphone: [], systemAudio: [] }
  const journal = path.join(directory, 'tracks.journal')
  let bytes = 0, maxMs = 0, appends = 0
  const started = performance.now()
  for (const step of timeline(minutes)) {
    if (step.kind === 'page') { pages.push({ path: `${step.index}`, firstSequence: step.index * 256, lastSequence: step.index * 256 + 255 }); continue }
    for (const kind of ['microphone', 'systemAudio']) {
      const value = segment(step.start); segments[kind].push(value)
      const line = recordingTrackJournalLine(sessionId, { type: 'seal', kind, segment: value })
      const at = performance.now()
      await writeDurable(journal, line, 'a')
      bytes += Buffer.byteLength(line); appends++; maxMs = Math.max(maxMs, performance.now() - at)
    }
  }
  // 停止：一次写全。
  const at = performance.now()
  Object.assign(content, { status: 'stopped', eventPages: pages, tracks: { version: 1, sessionId, originUs: 1, tracks: Object.entries(segments).map(([kind, list]) => ({ kind, segments: list, gaps: [], warnings: [] })) } })
  content.media = Object.entries(segments).map(([kind, list], index) => ({ id: `${kind}-joined-${index}`, kind, path: path.join(directory, `${kind}-joined-000.wav`), monoUs: 0, durationUs: list.length * SEGMENT_US }))
  const text = JSON.stringify(recordingDocumentSchema.parse(structuredClone(content)))
  await writeDurable(path.join(directory, 'new.hjrec'), text)
  const finalMs = performance.now() - at
  return { appends, bytes: bytes + Buffer.byteLength(text), maxMs, finalMs, elapsedMs: performance.now() - started, finalBytes: Buffer.byteLength(text) }
}

/** 正式事件采集器按 120 Hz 光标灌满两小时的事件，页文件照实写盘（内容寻址名、fsync），看写盘是否积压。 */
async function eventPages(directory, minutes) {
  const ownerRef = { kind: 'screen_recording.session', id: randomUUID() }
  let pages = 0, bytes = 0, maxMs = 0
  const collector = new CaptureLogCollector({ ownerRef, sourceDigest: `sha256:${'b'.repeat(64)}`, originUs: 0, id: randomUUID }, async page => {
    const at = performance.now(), text = JSON.stringify(page), hash = createHash('sha256').update(text).digest('hex')
    await writeDurable(path.join(directory, `${String(page.seqSpan[0]).padStart(16, '0')}-${hash}.capture.json`), text, 'wx')
    pages++; bytes += Buffer.byteLength(text); maxMs = Math.max(maxMs, performance.now() - at)
  }, error => { throw error })
  const started = performance.now(), total = minutes * 60 * 120
  collector.start(0)
  for (let index = 1; index < total; index++) {
    collector.record(index * 8333, { kind: 'cursor', point: [960 + Math.round(Math.sin(index / 50) * 400), 540], shape: 'arrow' })
    // 每两秒让出一次事件循环，与真实录制里写盘与采集交错进行一致。
    if (index % 240 === 0) await new Promise(resolve => setImmediate(resolve))
  }
  await collector.stop(total * 8333)
  return { events: total, pages, bytes, maxMs, peakBacklog: collector.peakBacklog, elapsedMs: performance.now() - started }
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-recording-stress-'))
  const mb = value => (value / 1024 / 1024).toFixed(1)
  try {
    console.log('旧做法（每次封页/封段整份写文档）')
    console.log('录制分钟 | 文档保存次数 | 文档写入总量 MB | 最后一次文档 MB | 单次最长 ms | 合计耗时 s')
    for (const minutes of oldMinutes) {
      const dir = await fsp.mkdtemp(path.join(root, 'old-')), r = await oldModel(dir, minutes)
      console.log(`${minutes} | ${r.saves} | ${mb(r.bytes)} | ${mb(r.finalBytes)} | ${r.maxMs.toFixed(1)} | ${(r.elapsedMs / 1000).toFixed(1)}`)
      await fsp.rm(dir, { recursive: true, force: true })
    }
    console.log('\n新做法（事件页只记索引；每段声音追加一行记录；停止时写一次）')
    console.log('录制分钟 | 追加次数 | 记录+文档写入总量 MB | 单次追加最长 ms | 停止时文档 MB | 停止写文档 ms | 合计耗时 s')
    for (const minutes of newMinutes) {
      const dir = await fsp.mkdtemp(path.join(root, 'new-')), r = await newModel(dir, minutes)
      console.log(`${minutes} | ${r.appends} | ${mb(r.bytes)} | ${r.maxMs.toFixed(1)} | ${mb(r.finalBytes)} | ${r.finalMs.toFixed(1)} | ${(r.elapsedMs / 1000).toFixed(1)}`)
      await fsp.rm(dir, { recursive: true, force: true })
    }
    const minutes = Math.max(...newMinutes)
    const dir = await fsp.mkdtemp(path.join(root, 'events-')), r = await eventPages(dir, minutes)
    console.log(`\n事件页（正式采集器，${minutes} 分钟、120 Hz 光标，尽快灌入）`)
    console.log(`事件 ${r.events} 条 → ${r.pages} 页、${mb(r.bytes)} MB；单页写盘最长 ${r.maxMs.toFixed(1)} ms；积压峰值 ${r.peakBacklog} 页；灌完 ${(r.elapsedMs / 1000).toFixed(1)} s（真实录制用时 ${minutes * 60} s）`)
  } finally { await fsp.rm(root, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
