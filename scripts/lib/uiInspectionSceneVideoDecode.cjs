const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { videoFramesHarness } = require('./uiInspectionSceneVideoFrames.cjs')

/**
 * 原生解码会话（1.3）：真实素材 → 原生 FFmpeg 解码（D3D11VA 硬解或软解 + 显卡转换）→ 共享纹理 → 剪辑渲染 Worker。
 *
 * 阶段（HENJI_VIDEO_DECODE_PHASES 逗号分隔，缺省全部）：
 * - experiment：传输特性标注实验（重要记录 007）——同一帧以 nv12/rgbaf16、bt709/srgb 标注导入，与浏览器后端
 *   （mediabunny + WebCodecs）同一帧、FFmpeg 参考 R'G'B' 逐点比较；
 * - pixels：每种样本取首帧、关键帧前后、B 帧、末帧，Worker 读回与同版本 FFmpeg（与服务链接的同一份 BtbN 构建，重要记录 014）参考帧比较，
 *   并以“目标帧比相邻帧更接近参考”确认取到的是目标帧；
 * - seek：按时间随机取帧的 PTS 正确性与冷/热耗时（IPC 到 Worker 收到帧）；
 * - schedule：带剪辑点的连续计划，逐项核对 PTS；
 * - load：每种格式单路 4K60（ProRes 4444 用 2560²）按 60Hz 节拍消费 HENJI_VIDEO_DECODE_LOAD_SECONDS 秒（默认 60）；
 * - soak：两路（H.264 硬解 nv12 + ProRes 软解 rgbaf16）连续播放 HENJI_VIDEO_DECODE_SOAK_SECONDS 秒（默认 600），
 *   每 30 秒记录句柄、显存，结束后会话关闭、资源回到基线。
 * 缩短时长的结果不能作为验收数字。证据写入 node_modules/.cache/video-decode/evidence.json。
 */

const ROOT = path.resolve('node_modules/.cache/video-decode')
const SAMPLES = path.resolve('node_modules/.cache/native-decode')
const FFMPEG_BIN = require('./mediaBinaries.cjs').binDir
const FFMPEG = path.join(FFMPEG_BIN, 'ffmpeg.exe')
const FFPROBE = path.join(FFMPEG_BIN, 'ffprobe.exe')
const INTRO = 'D:/视频制作/0A0片头片尾和素材/2021片头V2 4K 60FPS.mp4'
const TRIPO_NVENC = 'D:/视频制作/2026-09-19_Tripo/素材/001_早期场景收束拉远_v1.mp4'
const TRIPO_4444 = 'D:/视频制作/2026-09-19_Tripo/素材/010_荷花_高细节_独立透明缓转_v2.mov'
const PHASES = new Set((process.env.HENJI_VIDEO_DECODE_PHASES || 'experiment,pixels,seek,schedule,load,soak').split(',').map((value) => value.trim()))
const LOAD_SECONDS = Number(process.env.HENJI_VIDEO_DECODE_LOAD_SECONDS ?? 60)
const SOAK_SECONDS = Number(process.env.HENJI_VIDEO_DECODE_SOAK_SECONDS ?? 600)
const ONLY = process.env.HENJI_VIDEO_DECODE_ONLY ? new Set(process.env.HENJI_VIDEO_DECODE_ONLY.split(',')) : null
const GRID = [48, 27]

/** 像素与取帧样本：第 1、2 步所列格式与开放 GOP、可变帧率、编辑列表、透明。 */
const SAMPLE_LIST = [
  { id: 'h264', file: INTRO, browser: true },
  { id: 'h264-nvenc-pc', file: TRIPO_NVENC, browser: true },
  { id: 'h264-editlist', file: path.join(SAMPLES, 'h264_aac.mp4'), browser: true },
  { id: 'h264-opengop', file: path.join(SAMPLES, 't_h264_opengop.mp4'), browser: true },
  { id: 'h264-vfr', file: path.join(SAMPLES, 't_h264_vfr.mkv'), browser: true },
  { id: 'hevc8', file: path.join(SAMPLES, 't_hevc8.mp4') },
  { id: 'hevc10', file: path.join(SAMPLES, 'hevc10.mp4') },
  { id: 'av1', file: path.join(SAMPLES, 'av1.mp4'), browser: true },
  { id: 'vp9-p2', file: path.join(SAMPLES, 't_vp9_p2.webm') },
  // 透明 VP9：参考帧也须用 libvpx-vp9 解（FFmpeg 原生 vp9 解码器不解透明层）。
  { id: 'vp9-alpha', file: path.join(SAMPLES, 't_vp9_alpha.webm'), alpha: true, referenceDecoder: 'libvpx-vp9' },
  { id: 'mpeg2-ps', file: path.join(SAMPLES, 'mpeg2.mpg') },
  { id: 'prores422hq', file: path.join(SAMPLES, 'prores422hq.mov') },
  { id: 'prores4444-alpha', file: TRIPO_4444, alpha: true },
  { id: 'dnxhr-hqx', file: path.join(SAMPLES, 'dnxhr_hqx.mov') },
  { id: 'dnxhr-hq-mxf', file: path.join(SAMPLES, 'dnxhr_hq.mxf') },
  { id: 'cineform', file: path.join(SAMPLES, 't_cfhd.mov') },
  { id: 'h264-422-10', file: path.join(SAMPLES, 't_h264_422_10.mp4') },
  // 罕见像素格式（调色板 PNG）：CPU 转换回落路径。
  { id: 'cpu-fallback-pal8', file: path.join(SAMPLES, 't_png_pal8.mov'), alpha: true },
].filter((sample) => !ONLY || ONLY.has(sample.id))

/** 单路 4K60 负载：素材循环播放到指定时长（避开文件末尾，循环处为剪辑点、不 flush）。 */
const LOAD_LIST = [
  { id: 'h264', file: path.join(SAMPLES, 'long_h264.mp4'), required: true },
  { id: 'hevc10', file: path.join(SAMPLES, 'long_hevc10.mp4'), required: true },
  { id: 'av1', file: path.join(SAMPLES, 'long_av1.mp4'), required: true },
  { id: 'prores422hq', file: path.join(SAMPLES, 'long_prores422hq.mov'), required: true },
  { id: 'dnxhr-hqx', file: path.join(SAMPLES, 'long_dnxhr_hqx.mov'), required: true },
  { id: 'prores4444-2560', file: TRIPO_4444, required: false },
  { id: 'cineform', file: path.join(SAMPLES, 't_cfhd.mov'), required: false },
  { id: 'h264-422-10', file: path.join(SAMPLES, 't_h264_422_10.mp4'), required: false },
].filter((sample) => !ONLY || ONLY.has(sample.id))

const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits
const { quantile, processResources, totalGpuMemoryMiB, cpuSample, cpuCores, installHarness } = videoFramesHarness

function probeFrames(file) {
  // 用 JSON 顶层 streams：ffprobe 9.0 的 -show_entries stream=… 还会输出 stream_groups 内的同一流，csv 会重复。
  const tb = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=time_base', '-of', 'json', file], { encoding: 'utf8', windowsHide: true })).streams[0].time_base
  const [num, den] = tb.split('/').map(Number)
  // JSON 输出带字段名（csv 的列序是 ffprobe 内部顺序，不是请求顺序）。
  const data = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts,best_effort_timestamp,key_frame', '-of', 'json', file], { encoding: 'utf8', windowsHide: true, maxBuffer: 2 ** 30 }))
  const frames = data.frames.map((frame) => ({ pts: Number(frame.pts ?? frame.best_effort_timestamp), key: frame.key_frame === 1 })).filter((frame) => Number.isFinite(frame.pts))
  return { timeBase: { num, den }, frames }
}

const toUs = (pts, tb) => Math.trunc((pts * tb.num * 1e6) / tb.den)
const toSeconds = (pts, tb) => (pts * tb.num) / tb.den

/** 期望帧：呈现时间 ≤ t 的最后一帧（mediabunny 口径）。 */
function expectedPts(seconds, sorted, tb) {
  const x = (seconds * tb.den) / tb.num
  const r = Math.round(x)
  const ticks = r !== 0 && Math.abs(x / r - 1) < 10 * Number.EPSILON ? r : Math.floor(x)
  let found = null
  for (const pts of sorted) { if (pts <= ticks) found = pts; else break }
  return found === null ? null : toUs(found, tb)
}

/** 进程线程数（诊断：负载开始时是否残留软解线程）。 */
function processThreads(pid) {
  try {
    return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).Threads.Count`], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim())
  } catch {
    return null
  }
}

/** 整机 CPU 占用（%，诊断：负载开始时的背景负载）。 */
function systemCpuPercent() {
  try {
    const command = "[math]::Round((Get-Counter '\\Processor(_Total)\\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples[0].CookedValue, 1)"
    return Number(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, timeout: 15000 }).trim())
  } catch {
    return null
  }
}

function gridCoords(width, height) {
  const coords = []
  for (let row = 0; row < GRID[1]; row++) for (let column = 0; column < GRID[0]; column++) coords.push(Math.min(width - 1, Math.floor(((column + 0.5) * width) / GRID[0])), Math.min(height - 1, Math.floor(((row + 0.5) * height) / GRID[1])))
  return coords
}

const SWS_MATRIX = { bt709: 'bt709', bt470bg: 'bt601', smpte170m: 'bt601', 'bt2020-ncl': 'bt2020', smpte240m: 'smpte240m', fcc: 'fcc' }

/** FFmpeg 参考帧（按呈现顺序的帧号）：swscale 按同一矩阵与范围转为非线性 R'G'B'（gbrpf32），按坐标取样。 */
function referenceFrames(file, indices, color, size, alpha, coords, decoder) {
  const unique = [...new Set(indices)].sort((a, b) => a - b)
  const select = unique.map((index) => `eq(n\\,${index})`).join('+')
  const matrix = SWS_MATRIX[color.matrix] ?? 'bt709'
  const range = color.range === 'full' ? 'pc' : 'tv'
  const format = alpha ? 'gbrapf32le' : 'gbrpf32le'
  const filter = `select='${select}',scale=in_color_matrix=${matrix}:in_range=${range}:out_range=pc:flags=accurate_rnd+full_chroma_int+full_chroma_inp+bitexact,format=${format}`
  const raw = execFileSync(FFMPEG, ['-v', 'error', ...(decoder ? ['-c:v', decoder] : []), '-i', file, '-map', '0:v:0', '-vf', filter, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 2 ** 31 })
  const planes = alpha ? 4 : 3
  const frameBytes = size[0] * size[1] * 4 * planes
  assert.equal(raw.length, frameBytes * unique.length, `参考帧数据长度不符（${raw.length} / ${frameBytes * unique.length}）`)
  const result = new Map()
  unique.forEach((index, order) => {
    const view = new Float32Array(raw.buffer, raw.byteOffset + order * frameBytes, frameBytes / 4)
    const plane = size[0] * size[1]
    const samples = []
    for (let point = 0; point < coords.length / 2; point++) {
      const offset = coords[point * 2 + 1] * size[0] + coords[point * 2]
      // gbrp：平面顺序 G、B、R（、A）。
      samples.push(view[2 * plane + offset], view[offset], view[plane + offset], alpha ? view[3 * plane + offset] : 1)
    }
    result.set(index, samples)
  })
  return result
}

function compare(got, reference, alpha) {
  let maxError = 0
  let sum = 0
  let alphaMax = 0
  let count = 0
  for (let index = 0; index < reference.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const value = Math.min(1, Math.max(0, reference[index + channel]))
      const error = Math.abs(got[index + channel] - value)
      maxError = Math.max(maxError, error)
      sum += error * error
      count += 1
    }
    if (alpha) alphaMax = Math.max(alphaMax, Math.abs(got[index + 3] - reference[index + 3]))
  }
  const mse = sum / count
  return { maxError: round(maxError), meanSquared: mse, psnr: mse > 0 ? round(10 * Math.log10(1 / mse), 2) : 99, alphaMaxError: alpha ? round(alphaMax) : undefined }
}

const diagnose = (page, request) => page.evaluate((value) => window.__henjiVideoFrames.diagnose(value), request)
const bridgeStats = (page) => page.evaluate(() => window.henjiNative.videoFrames.stats())
const closeStream = (page, streamId) => page.evaluate((id) => window.henjiNative.videoFrames.closeStream(id), streamId)
const openDecoder = (page, request) => page.evaluate((value) => window.henjiNative.videoFrames.openDecoder({ route: window.__henjiVideoFrames.route, ...value }), request)
const mediaUrl = (file) => `henji-media://local/${encodeURIComponent(file)}`

/** 取一帧并在 Worker 读回：返回原生响应、读回结果与 IPC→Worker 的耗时。 */
async function frameAtCapture(page, streamId, time, ticket, coords) {
  return page.evaluate(async ({ streamId, time, ticket, coords }) => {
    const started = performance.now()
    const capture = window.__henjiVideoFrames.diagnose({ action: 'capture', streamId, ticket, coords, timeoutMs: 15000 })
    const response = await window.henjiNative.videoFrames.frameAt({ streamId, time, ticket })
    const responseMs = performance.now() - started
    if (!response.found) {
      // 无画面：不会有帧，读回会超时；直接返回。
      void capture.catch(() => undefined)
      return { response, responseMs }
    }
    const result = await capture
    return { response, responseMs, arrivedMs: performance.now() - started, capture: result.decode.capture }
  }, { streamId, time, ticket, coords })
}

async function waitForQuiet(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  let stats
  do {
    stats = await bridgeStats(page)
    if (stats.streams.length === 0 && (stats.native?.streams.length ?? 0) === 0) return stats
    await page.waitForTimeout(250)
  } while (Date.now() < deadline)
  return stats
}

async function resourceSnapshot(app, page) {
  const pids = await app.evaluate(({ app: electronApp }) => ({ main: process.pid, gpu: electronApp.getAppMetrics().find((metric) => metric.type === 'GPU')?.pid }))
  const stats = await bridgeStats(page)
  const nativePid = stats.native?.pid
  const resources = processResources([pids.main, pids.gpu, nativePid].filter(Boolean))
  return {
    at: new Date().toISOString(),
    main: resources[pids.main],
    gpuProcess: resources[pids.gpu] ? { handles: resources[pids.gpu].handles, workingSetMiB: resources[pids.gpu].workingSetMiB } : null,
    nativeProcess: nativePid ? { handles: resources[nativePid]?.handles, workingSetMiB: resources[nativePid]?.workingSetMiB, gpuLocalMemoryMiB: stats.native.gpuLocalMemory ? Math.round(stats.native.gpuLocalMemory.currentUsageBytes / 1048576) : null } : null,
    gpuTotalUsedMiB: totalGpuMemoryMiB(),
    openStreams: stats.streams.length,
    nativeStreams: stats.native?.streams.length ?? null,
    unreleasedImports: stats.unreleasedImports,
    preloadOutstanding: stats.preload.outstanding,
  }
}

/** 步骤 0：传输特性标注实验。 */
async function runExperiment(page, evidence, store) {
  const cases = [
    { id: 'h264', file: INTRO, index: 120 },
    { id: 'h264-nvenc-pc', file: TRIPO_NVENC, index: 120 },
    { id: 'prores4444', file: TRIPO_4444, index: 300, alpha: true },
    { id: 'hevc10', file: path.join(SAMPLES, 'hevc10.mp4'), index: 120 },
  ]
  evidence.experiment = []
  for (const item of cases) {
    if (!fs.existsSync(item.file)) continue
    const { timeBase, frames } = probeFrames(item.file)
    const sorted = frames.map((frame) => frame.pts).sort((a, b) => a - b)
    const time = toSeconds(sorted[item.index], timeBase)
    const variants = [
      { label: 'default', options: {} },
      { label: 'transfer-srgb', options: { transfer: 'srgb' } },
      { label: 'transfer-bt709', options: { transfer: 'bt709' } },
    ]
    await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(item.file))
    const first = await openDecoder(page, { path: item.file, purpose: 'seek' })
    await closeStream(page, first.streamId)
    if (first.format === 'nv12') variants.push({ label: 'rgbaf16-default', options: { format: 'rgbaf16' } }, { label: 'rgbaf16-srgb', options: { format: 'rgbaf16', transfer: 'srgb' } }, { label: 'rgbaf16-bt709', options: { format: 'rgbaf16', transfer: 'bt709' } })
    const size = [first.visibleRect.width, first.visibleRect.height]
    const coords = gridCoords(size[0], size[1])
    const result = { id: item.id, time, nativeColor: first.colorSpace, format: first.format, variants: {} }
    for (const variant of variants) {
      const info = await openDecoder(page, { path: item.file, purpose: 'seek', ...variant.options })
      const outcome = await frameAtCapture(page, info.streamId, time, `x-${variant.label}`, coords)
      await closeStream(page, info.streamId)
      result.variants[variant.label] = { format: info.format, colorSpace: info.colorSpace, frameColorSpace: outcome.capture?.colorSpace, ptsUs: outcome.capture?.ptsUs, samples: outcome.capture?.samples }
    }
    const reference = referenceFrames(item.file, [item.index], first.color, size, Boolean(item.alpha), coords).get(item.index)
    if (!item.alpha) {
      try {
        const browser = await diagnose(page, { action: 'browserCapture', url: mediaUrl(item.file), time, coords })
        result.variants.browser = { format: browser.decode.capture.frameFormat, frameColorSpace: browser.decode.capture.colorSpace, ptsUs: browser.decode.capture.ptsUs, samples: browser.decode.capture.samples }
      } catch (error) {
        result.variants.browser = { error: String(error?.message ?? error) }
      }
    }
    result.versusReference = {}
    result.versusDefault = {}
    for (const [label, variant] of Object.entries(result.variants)) {
      if (!variant.samples) continue
      result.versusReference[label] = compare(variant.samples, reference, Boolean(item.alpha))
      result.versusDefault[label] = compare(variant.samples, result.variants.default.samples, false)
    }
    for (const variant of Object.values(result.variants)) delete variant.samples
    evidence.experiment.push(result)
    store()
    console.log(`[video-decode] 实验 ${item.id}`, JSON.stringify({ versusReference: result.versusReference, versusDefault: result.versusDefault }))
  }
}

function checkpoints(frames) {
  const count = frames.length
  const keys = frames.map((frame, index) => (frame.key ? index : -1)).filter((index) => index > 0)
  const key = keys.find((index) => index > 2 && index < count - 3) ?? Math.floor(count / 2)
  const points = [
    { label: '首帧', index: 0 },
    { label: '第二帧', index: 1 },
    { label: '关键帧前', index: key - 1 },
    { label: '关键帧', index: key },
    { label: '关键帧后（B 帧）', index: key + 1 },
    { label: '中段', index: Math.floor(count * 0.37) },
    { label: '末帧', index: count - 1 },
  ]
  return points.filter((point, position) => point.index >= 0 && point.index < count && points.findIndex((other) => other.index === point.index) === position)
}

async function runPixels(page, evidence, store) {
  evidence.pixels = []
  for (const sample of SAMPLE_LIST) {
    if (!fs.existsSync(sample.file)) { evidence.pixels.push({ id: sample.id, skipped: '样本缺失' }); continue }
    await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(sample.file))
    const { timeBase, frames } = probeFrames(sample.file)
    const sorted = frames.map((frame) => frame.pts).sort((a, b) => a - b)
    // 帧标志按呈现顺序（ffprobe 输出即呈现顺序）。
    const info = await openDecoder(page, { path: sample.file, purpose: 'seek' })
    const size = [info.visibleRect.width, info.visibleRect.height]
    const coords = gridCoords(size[0], size[1])
    const points = checkpoints(frames)
    const indices = points.flatMap((point) => [point.index - 1, point.index, point.index + 1]).filter((index) => index >= 0 && index < sorted.length)
    const reference = referenceFrames(sample.file, indices, info.color, size, Boolean(sample.alpha), coords, sample.referenceDecoder)
    const results = []
    for (const point of points) {
      const time = toSeconds(sorted[point.index], timeBase)
      const outcome = await frameAtCapture(page, info.streamId, time, `p-${sample.id}-${point.index}`, coords)
      const expected = toUs(sorted[point.index], timeBase)
      const entry = { label: point.label, index: point.index, time: round(time, 6), expectedPtsUs: expected, gotPtsUs: outcome.capture?.ptsUs ?? null, frameFormat: outcome.capture?.frameFormat ?? null }
      if (outcome.capture) {
        entry.metrics = compare(outcome.capture.samples, reference.get(point.index), Boolean(sample.alpha))
        entry.neighbors = [point.index - 1, point.index + 1].filter((index) => reference.has(index)).map((index) => ({ index, psnr: compare(outcome.capture.samples, reference.get(index), false).psnr, identicalToTarget: compare(reference.get(index), reference.get(point.index), false).psnr >= 60 }))
        entry.identity = entry.neighbors.every((neighbor) => neighbor.identicalToTarget || neighbor.psnr < entry.metrics.psnr) ? 'target' : 'ambiguous'
      }
      results.push(entry)
    }
    await closeStream(page, info.streamId)
    const summary = {
      id: sample.id,
      file: sample.file,
      format: info.format,
      decoder: info.decoder,
      colorSpace: info.colorSpace,
      ptsCorrect: results.every((entry) => entry.gotPtsUs === entry.expectedPtsUs),
      minPsnr: Math.min(...results.filter((entry) => entry.metrics).map((entry) => entry.metrics.psnr)),
      maxError: Math.max(...results.filter((entry) => entry.metrics).map((entry) => entry.metrics.maxError)),
      alphaMaxError: sample.alpha ? Math.max(...results.filter((entry) => entry.metrics).map((entry) => entry.metrics.alphaMaxError)) : undefined,
      identity: results.every((entry) => entry.identity !== 'ambiguous') ? 'target' : 'ambiguous',
      points: results,
    }
    evidence.pixels.push(summary)
    store()
    console.log(`[video-decode] 像素 ${sample.id}`, JSON.stringify({ format: summary.format, decoder: `${info.decoder.decoderName}/${info.decoder.hardware ? 'hw' : 'sw'}/${info.decoder.path}`, ptsCorrect: summary.ptsCorrect, minPsnr: summary.minPsnr, maxError: summary.maxError, alpha: summary.alphaMaxError, identity: summary.identity }))
  }
}

async function runSeek(page, evidence, store) {
  evidence.seek = []
  for (const sample of SAMPLE_LIST) {
    if (!fs.existsSync(sample.file)) continue
    await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(sample.file))
    const { timeBase, frames } = probeFrames(sample.file)
    const sorted = frames.map((frame) => frame.pts).sort((a, b) => a - b)
    const start = toSeconds(sorted[0], timeBase)
    const end = toSeconds(sorted[sorted.length - 1], timeBase)
    const info = await openDecoder(page, { path: sample.file, purpose: 'seek' })
    const cold = []
    const warm = []
    const mismatches = []
    let seed = 7
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let round_ = 0; round_ < 12; round_++) {
      // 冷：跳到随机位置（定位 + 解到目标）；热：紧接着的下一帧（续解）。
      const time = start + random() * (end - start)
      const coldOutcome = await frameAtCapture(page, info.streamId, time, `c-${sample.id}-${round_}`, [0, 0])
      cold.push(coldOutcome.arrivedMs ?? coldOutcome.responseMs)
      const expected = expectedPts(time, sorted, timeBase)
      if ((coldOutcome.capture?.ptsUs ?? null) !== expected) mismatches.push({ time, expected, got: coldOutcome.capture?.ptsUs ?? null })
      const nextIndex = sorted.findIndex((pts) => toUs(pts, timeBase) > (expected ?? -Infinity))
      if (nextIndex > 0) {
        const nextTime = toSeconds(sorted[nextIndex], timeBase)
        const warmOutcome = await frameAtCapture(page, info.streamId, nextTime, `w-${sample.id}-${round_}`, [0, 0])
        warm.push(warmOutcome.arrivedMs ?? warmOutcome.responseMs)
        if ((warmOutcome.capture?.ptsUs ?? null) !== toUs(sorted[nextIndex], timeBase)) mismatches.push({ time: nextTime, expected: toUs(sorted[nextIndex], timeBase), got: warmOutcome.capture?.ptsUs ?? null })
      }
    }
    // 边界：首帧之前、末帧之后。
    for (const time of [start - 0.5, end + 3]) {
      const outcome = await frameAtCapture(page, info.streamId, time, `b-${sample.id}-${time}`, [0, 0])
      const expected = expectedPts(time, sorted, timeBase)
      if ((outcome.capture?.ptsUs ?? null) !== expected) mismatches.push({ time, expected, got: outcome.capture?.ptsUs ?? null })
    }
    const stats = (await bridgeStats(page)).native?.streams.find((stream) => stream.streamId === info.streamId)?.counters
    await closeStream(page, info.streamId)
    const sortedCold = [...cold].sort((a, b) => a - b)
    const sortedWarm = [...warm].sort((a, b) => a - b)
    const entry = { id: sample.id, format: info.format, decoder: `${info.decoder.decoderName}/${info.decoder.hardware ? 'hw' : 'sw'}`, intraOnly: info.decoder.intraOnly, mismatches, coldMs: { p50: round(quantile(sortedCold, 0.5), 1), max: round(sortedCold.at(-1) ?? 0, 1) }, warmMs: { p50: round(quantile(sortedWarm, 0.5), 1), max: round(sortedWarm.at(-1) ?? 0, 1) }, counters: stats }
    evidence.seek.push(entry)
    store()
    console.log(`[video-decode] 取帧 ${sample.id}`, JSON.stringify({ mismatches: mismatches.length, cold: entry.coldMs, warm: entry.warmMs }))
  }
}

/** 连续计划：从 1/3 处顺播 → 剪辑点回开头 → 跳到 2/3 → 再回开头（逐项核对 PTS，计数 flush）。 */
async function runSchedule(page, evidence, store) {
  evidence.schedule = []
  for (const sample of SAMPLE_LIST) {
    if (!fs.existsSync(sample.file)) continue
    await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(sample.file))
    const { timeBase, frames } = probeFrames(sample.file)
    const sorted = frames.map((frame) => frame.pts).sort((a, b) => a - b)
    const start = toSeconds(sorted[0], timeBase)
    const duration = toSeconds(sorted[sorted.length - 1], timeBase) - start
    const info = await openDecoder(page, { path: sample.file, purpose: 'playback' })
    const fps = info.fps > 0 ? info.fps : 30
    const segment = (from, count) => Array.from({ length: count }, (_, index) => from + index / fps)
    const times = [...segment(start + duration / 3, 60), ...segment(start, 30), ...segment(start + (duration * 2) / 3, 30), ...segment(start, 30)].filter((time) => time <= start + duration)
    const scheduleId = `s-${sample.id}`
    await diagnose(page, { action: 'pace', streamId: info.streamId, scheduleId, count: times.length, fps: 0 })
    await page.evaluate((request) => window.henjiNative.videoFrames.schedule(request), { streamId: info.streamId, scheduleId, times })
    const result = (await diagnose(page, { action: 'paceResult', streamId: info.streamId, timeoutMs: 60000 })).decode.pace
    const counters = (await bridgeStats(page)).native?.streams.find((stream) => stream.streamId === info.streamId)?.counters
    await closeStream(page, info.streamId)
    // 收集模式：帧到达即交回，只核对每项的帧（不作为帧率数字）。
    const mismatches = []
    times.forEach((time, index) => {
      const expected = expectedPts(time, sorted, timeBase)
      const got = result.ptsByIndex[index]
      if (got !== expected) mismatches.push({ index, time: round(time, 6), expected, got })
    })
    const entry = { id: sample.id, requested: times.length, mismatches: mismatches.slice(0, 10), mismatchCount: mismatches.length, scheduleDone: result.scheduleDone, flushes: counters?.flushes, eofFlushes: counters?.eofFlushes, cuts: counters?.cuts, discarded: counters?.discarded }
    evidence.schedule.push(entry)
    store()
    console.log(`[video-decode] 计划 ${sample.id}`, JSON.stringify(entry))
  }
}

/** 循环播放到 `seconds` 秒的计划时间（循环点为剪辑点；末尾留 0.2 秒避免解码器排空）。 */
function loopTimes(start, end, fps, seconds) {
  const usable = end - start - 0.2
  return Array.from({ length: Math.round(seconds * fps) }, (_, index) => start + ((index / fps) % usable))
}

async function runLoad(page, app, evidence, store) {
  evidence.loads = []
  for (const sample of LOAD_LIST) {
    if (!fs.existsSync(sample.file)) { evidence.loads.push({ id: sample.id, skipped: '样本缺失' }); continue }
    await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(sample.file))
    const info = await openDecoder(page, { path: sample.file, purpose: 'playback' })
    const start = info.startSeconds ?? 0
    const end = info.endSeconds ?? start + 7
    const times = loopTimes(start, end, 60, LOAD_SECONDS)
    const scheduleId = `l-${sample.id}`
    // 预滚：纹理池填满（解码领先量与正式播放一致）再开始节拍。
    await diagnose(page, { action: 'pace', streamId: info.streamId, scheduleId, count: times.length, fps: 60, warmupFrames: info.poolSize })
    const atStart = await bridgeStats(page)
    const nativePid = atStart.native?.pid
    const startState = { bridgeStreams: atStart.streams.length, nativeStreams: atStart.native?.streams.length ?? null, nativeThreads: nativePid ? processThreads(nativePid) : null, systemCpuPercent: systemCpuPercent() }
    await page.evaluate((request) => window.henjiNative.videoFrames.schedule(request), { streamId: info.streamId, scheduleId, times })
    const before = await cpuSample(app, page)
    const vramBefore = totalGpuMemoryMiB()
    const pace = (await diagnose(page, { action: 'paceResult', streamId: info.streamId, timeoutMs: (LOAD_SECONDS + 60) * 1000 })).decode.pace
    const after = await cpuSample(app, page)
    const vramDuring = totalGpuMemoryMiB()
    const stats = await bridgeStats(page)
    const bridge = stats.streams.find((stream) => stream.streamId === info.streamId)
    const native = stats.native?.streams.find((stream) => stream.streamId === info.streamId)?.counters
    await closeStream(page, info.streamId)
    const entry = {
      id: sample.id,
      size: `${info.visibleRect.width}x${info.visibleRect.height}`,
      format: info.format,
      decoder: `${info.decoder.decoderName}/${info.decoder.hardware ? 'hw' : 'sw'}/${info.decoder.path}`,
      seconds: LOAD_SECONDS,
      framesPerSecond: pace.framesPerSecond,
      ticks: pace.ticks,
      presented: pace.presented,
      late: pace.late,
      lateIndices: pace.lateIndices,
      missing: pace.missing,
      missingRatio: round((pace.late + pace.missing) / pace.ticks, 5),
      steady: { ...pace.steady, missingRatio: round((pace.steady.late + pace.steady.missing) / Math.max(1, pace.ticks - pace.steady.fromTick), 5) },
      startState,
      intervals: pace.intervals,
      leadMsMedian: pace.leadMsMedian,
      scheduleDone: pace.scheduleDone,
      errors: pace.errors,
      cpuCores: cpuCores(before, after),
      nativeGpuLocalMemoryMiB: stats.native?.gpuLocalMemory ? Math.round(stats.native.gpuLocalMemory.currentUsageBytes / 1048576) : null,
      gpuTotalMiB: { before: vramBefore, during: vramDuring },
      handoffMs: bridge?.handoffMs,
      native: native && { flushes: native.flushes, eofFlushes: native.eofFlushes, cuts: native.cuts, decodeErrors: native.decodeErrors, missing: native.missing, uploadUsAverage: Math.round(native.uploadUsAverage ?? 0), mapUsAverage: Math.round(native.mapUsAverage ?? 0), submitUsAverage: Math.round(native.renderUsAverage ?? 0), waitMsTotal: Math.round((native.waitUsTotal ?? 0) / 1000) },
    }
    evidence.loads.push(entry)
    store()
    console.log(`[video-decode] 负载 ${sample.id}`, JSON.stringify({ fps: entry.framesPerSecond, late: entry.late, lateAt: entry.lateIndices.slice(0, 8), steady: { fps: entry.steady.framesPerSecond, late: entry.steady.late, max: entry.steady.intervals.max }, start: entry.startState, max: entry.intervals.max, p99: entry.intervals.p99, cpu: entry.cpuCores.nativeService, native: entry.native }))
  }
}

async function runSoak(page, app, evidence, store) {
  const files = [path.join(SAMPLES, 'long_h264.mp4'), path.join(SAMPLES, 'long_prores422hq.mov')].filter((file) => fs.existsSync(file))
  // 基线取在“同样的会话各开关过一次”之后：硬件解码设备、着色器、解码库与线程池是进程内一次性初始化，
  // 不属于播放期间的资源增长（单独跑本阶段时服务还未启动，冷基线会把它们算成未回收）。
  for (const file of files) {
    await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(file))
    const warm = await openDecoder(page, { path: file, purpose: 'playback' })
    await diagnose(page, { action: 'pace', streamId: warm.streamId, scheduleId: 'warm', count: 30, fps: 0 })
    await page.evaluate((request) => window.henjiNative.videoFrames.schedule(request), { streamId: warm.streamId, scheduleId: 'warm', times: Array.from({ length: 30 }, (_, index) => (warm.startSeconds ?? 0) + index / 60) })
    await diagnose(page, { action: 'paceResult', streamId: warm.streamId, timeoutMs: 20000 })
    await closeStream(page, warm.streamId)
  }
  await waitForQuiet(page)
  await page.waitForTimeout(1000)
  evidence.soak = { baseline: await resourceSnapshot(app, page), samples: [] }
  const sessions = []
  for (const file of files) {
    await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(file))
    const info = await openDecoder(page, { path: file, purpose: 'playback' })
    const times = loopTimes(info.startSeconds ?? 0, info.endSeconds ?? 63, 60, SOAK_SECONDS)
    const scheduleId = `soak-${sessions.length}`
    await diagnose(page, { action: 'pace', streamId: info.streamId, scheduleId, count: times.length, fps: 60, warmupFrames: 4 })
    await page.evaluate((request) => window.henjiNative.videoFrames.schedule(request), { streamId: info.streamId, scheduleId, times })
    sessions.push({ info, file })
  }
  const started = Date.now()
  evidence.soak.samples.push({ elapsedSeconds: 0, ...(await resourceSnapshot(app, page)) })
  store()
  while (Date.now() - started < SOAK_SECONDS * 1000) {
    await page.waitForTimeout(Math.min(30000, SOAK_SECONDS * 1000 - (Date.now() - started)))
    evidence.soak.samples.push({ elapsedSeconds: Math.round((Date.now() - started) / 1000), ...(await resourceSnapshot(app, page)) })
    store()
  }
  evidence.soak.delivery = []
  for (const session of sessions) {
    const pace = (await diagnose(page, { action: 'paceResult', streamId: session.info.streamId, timeoutMs: 60000 })).decode.pace
    const counters = (await bridgeStats(page)).native?.streams.find((stream) => stream.streamId === session.info.streamId)?.counters
    evidence.soak.delivery.push({ file: path.basename(session.file), format: session.info.format, framesPerSecond: pace.framesPerSecond, late: pace.late, missing: pace.missing, intervals: pace.intervals, flushes: counters?.flushes, eofFlushes: counters?.eofFlushes, cuts: counters?.cuts })
    await closeStream(page, session.info.streamId)
  }
  await waitForQuiet(page)
  await page.waitForTimeout(1000)
  evidence.soak.afterClose = await resourceSnapshot(app, page)
  store()
  const baseline = evidence.soak.baseline
  const closed = evidence.soak.afterClose
  assert.equal(closed.openStreams, 0, '关闭后桥上仍有帧流')
  assert.equal(closed.nativeStreams, 0, '关闭后原生服务仍有会话')
  assert.equal(closed.unreleasedImports, baseline.unreleasedImports, '关闭后仍有未释放的导入')
  assert.ok(closed.nativeProcess.gpuLocalMemoryMiB <= baseline.nativeProcess.gpuLocalMemoryMiB + 96, `原生服务显存未回到基线：${closed.nativeProcess.gpuLocalMemoryMiB}MiB（基线 ${baseline.nativeProcess.gpuLocalMemoryMiB}MiB）`)
  assert.ok(closed.nativeProcess.handles <= baseline.nativeProcess.handles + 32, `原生服务句柄未回到基线：${closed.nativeProcess.handles}（基线 ${baseline.nativeProcess.handles}）`)
}

function createVideoDecodeScene() {
  return {
    id: 'video-decode-native',
    surface: '剪辑',
    name: '剪辑-原生解码会话格式像素一致性、取帧与4K60负载',
    writesUserData: false,
    setup: async (page, app) => {
      fs.mkdirSync(ROOT, { recursive: true })
      const evidence = {
        machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, memoryBytes: os.totalmem(), os: os.version() },
        settings: { phases: [...PHASES], loadSeconds: LOAD_SECONDS, soakSeconds: SOAK_SECONDS, only: ONLY ? [...ONLY] : null },
      }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = (name) => { evidence.currentPhase = name; store(); console.log(`[video-decode] ${name}`) }
      try {
        evidence.runtime = await app.evaluate(async ({ app: electronApp }) => ({ versions: process.versions, gpu: (await electronApp.getGPUInfo('basic')).gpuDevice }))
        evidence.isolation = await page.evaluate(() => ({ pageHasSharedTexture: typeof window.sharedTexture, videoFramesKeys: Object.keys(window.henjiNative.videoFrames).sort() }))
        assert.equal(evidence.isolation.pageHasSharedTexture, 'undefined', '页面不应拿到 sharedTexture')
        await installHarness(page)
        if (PHASES.has('experiment')) { phase('传输特性标注实验'); await runExperiment(page, evidence, store) }
        if (PHASES.has('pixels')) { phase('像素一致性'); await runPixels(page, evidence, store) }
        if (PHASES.has('seek')) { phase('按时间取帧'); await runSeek(page, evidence, store) }
        if (PHASES.has('schedule')) { phase('连续计划与剪辑点'); await runSchedule(page, evidence, store) }
        if (PHASES.has('load') && LOAD_SECONDS > 0) { phase('单路 4K60 负载'); await runLoad(page, app, evidence, store) }
        if (PHASES.has('soak') && SOAK_SECONDS > 0) { phase('长时间播放资源曲线'); await runSoak(page, app, evidence, store) }
        // 断言放在最后：一次运行收集全部证据。
        for (const entry of evidence.pixels ?? []) {
          if (entry.skipped) continue
          assert.ok(entry.ptsCorrect, `${entry.id} 取帧时间不正确`)
          // 阈值（1.3 定稿）：对 FFmpeg 参考帧 PSNR ≥ 45dB；透明通道最大误差 ≤ 0.01；取到的是目标帧而非相邻帧。
          assert.ok(entry.minPsnr >= 45, `${entry.id} 像素与参考帧 PSNR ${entry.minPsnr}dB 低于 45dB`)
          if (entry.alphaMaxError !== undefined) assert.ok(entry.alphaMaxError <= 0.01, `${entry.id} 透明通道误差 ${entry.alphaMaxError}`)
          assert.equal(entry.identity, 'target', `${entry.id} 读回的帧更接近相邻帧`)
        }
        for (const entry of evidence.seek ?? []) assert.deepEqual(entry.mismatches, [], `${entry.id} 按时间取帧不正确`)
        for (const entry of evidence.schedule ?? []) {
          assert.equal(entry.mismatchCount, 0, `${entry.id} 连续计划逐项不正确`)
          assert.equal(entry.flushes, 0, `${entry.id} 连续计划中出现 flush`)
        }
        for (const entry of evidence.loads ?? []) {
          if (entry.skipped || !LOAD_LIST.find((sample) => sample.id === entry.id)?.required || LOAD_SECONDS < 20) continue
          // 5.1 口径：开播 0.5 秒后计时（起播准备不计）；全程数字如实记录在证据里。
          assert.ok(entry.steady.framesPerSecond >= 59, `${entry.id} 4K60 送达 ${entry.steady.framesPerSecond} 帧/秒`)
          assert.ok(entry.steady.missingRatio <= 0.01, `${entry.id} 迟到/缺帧 ${entry.steady.missingRatio}`)
          assert.ok(entry.steady.intervals.max <= 100, `${entry.id} 最大间隔 ${entry.steady.intervals.max}ms`)
          assert.equal(entry.native?.flushes ?? 0, 0, `${entry.id} 播放中出现 flush`)
        }
        evidence.completed = true
        delete evidence.currentPhase
        store()
      } catch (error) {
        evidence.failed = { phase: evidence.currentPhase, message: String(error?.message ?? error) }
        store()
        throw error
      }
    },
  }
}

module.exports = { createVideoDecodeScene }
