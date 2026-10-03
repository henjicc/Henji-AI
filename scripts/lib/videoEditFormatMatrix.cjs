/**
 * 专业格式矩阵（任务 3.2）的样本定义、生成与参考数据。
 *
 * 每个样本用同版本 FFmpeg（scripts/lib/mediaBinaries.cjs，与原生服务同一份 BtbN 9.0 GPL 构建）生成，放在
 * node_modules/.cache/format-matrix/（只生成缺失的，`--force` 重新生成）：
 * - 画面：testsrc2 + 顶部帧号条码（16 格，第 X 格为帧号 N 的第 X 位，高度为画面的 1/9），导出或预览后逐帧解出条码即可确认是
 *   应有的源帧；透明样本条码带不透明，其下左 1/3 不透明、中 1/3 半透明（alpha 128）、右 1/3 全透明。
 * - 色彩标注一律写 BT.709 有限范围（MJPEG 为 JPEG 全范围），参考帧按文件标注转换，避免默认矩阵猜测（2.4 记录）。
 * - 声音：每条声音流每个声道 = 不同频率正弦 + 不同参数的扫频（非周期，互相关只有一个峰；与导出验收同一信号）。
 * 命令行：`node scripts/video-edit-format-samples.cjs [--only id,id] [--force]`。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve('node_modules/.cache/format-matrix')
const SECONDS = 3
/**
 * The app's container timestamp rounding tolerance (`VIDEO_EDIT_CONTAINER_TIMESTAMP_TOLERANCE_SECONDS`,
 * src/core/videoEdit/time.ts; uiInspection.test.cjs keeps the two equal): a picture lookup at time t shows the picture
 * starting at or before t + this, so a source-monitor seek may land on a picture starting up to this much after t.
 */
const PICTURE_TOLERANCE_SECONDS = 0.0006
const BITS = 16
const UHD = [3840, 2160]; const HD = [1920, 1080]
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv']
const JPEG_RANGE = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc']

const tone = frequency => `0.2*sin(2*PI*${frequency}*t)+0.1*sin(2*PI*(${frequency * 2 + 37}+${50 + frequency / 10}*t)*t)`

/**
 * 矩阵样本。`streams`：每条声音流的各声道频率；`rate`：声音采样率；`browser`：Chromium 能否完整解码（仅作强制浏览器
 * 时的期望，null 表示不预设、照实记录）；`alpha`：带透明。
 */
const SAMPLES = [
  { id: 'h264-8-420-mp4', label: 'H.264 High 8 位 4:2:0（MP4 + AAC）', container: 'mp4', size: UHD, fps: '60', browser: true, streams: [[260, 520]], video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', '60', '-bf', '2', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'aac', '-b:a', '256k'] },
  { id: 'h264-10-420-mp4', label: 'H.264 High 10 10 位 4:2:0（MP4 + AAC）', container: 'mp4', size: UHD, fps: '60', browser: null, streams: [[270, 540]], video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', '60', '-bf', '2', '-profile:v', 'high10', '-pix_fmt', 'yuv420p10le'], audio: ['-c:a', 'aac', '-b:a', '256k'] },
  { id: 'h264-10-422-mov', label: 'H.264 High 4:2:2 10 位（MOV + PCM 24 位）', container: 'mov', size: UHD, fps: '60', browser: null, streams: [[280, 560]], video: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', '60', '-bf', '2', '-profile:v', 'high422', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'hevc-8-420-mp4', label: 'HEVC Main 8 位 4:2:0（MP4 + MP3 44.1kHz）', container: 'mp4', size: UHD, fps: '60', browser: null, streams: [[290, 580]], rate: 44100, video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '18', '-x265-params', 'keyint=60:bframes=3:log-level=error', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'], audio: ['-c:a', 'libmp3lame', '-b:a', '256k'] },
  { id: 'hevc-10-420-mkv', label: 'HEVC Main10 10 位 4:2:0（MKV + FLAC）', container: 'mkv', size: UHD, fps: '60', browser: null, streams: [[300, 600]], video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '18', '-x265-params', 'keyint=60:bframes=3:log-level=error', '-pix_fmt', 'yuv420p10le'], audio: ['-c:a', 'flac'] },
  { id: 'hevc-10-422-mov', label: 'HEVC Main 4:2:2 10 位（MOV + PCM 24 位，相机常见）', container: 'mov', size: UHD, fps: '60000/1001', browser: null, streams: [[310, 620]], video: ['-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '18', '-x265-params', 'keyint=60:bframes=3:log-level=error', '-pix_fmt', 'yuv422p10le', '-tag:v', 'hvc1'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'av1-8-420-mp4', label: 'AV1 Main 8 位 4:2:0（MP4 + Opus）', container: 'mp4', size: UHD, fps: '60', browser: null, streams: [[320, 640]], video: ['-c:v', 'libsvtav1', '-preset', '12', '-crf', '30', '-g', '60', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'libopus', '-b:a', '192k'] },
  { id: 'vp9-8-420-webm', label: 'VP9 Profile 0 8 位 4:2:0（WebM + Vorbis）', container: 'webm', size: UHD, fps: '60', browser: null, streams: [[330, 660]], video: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '40M', '-g', '60', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'libvorbis', '-q:a', '6'] },
  { id: 'vp9-alpha-webm', label: 'VP9 透明（WebM + Opus）', container: 'webm', size: UHD, fps: '60', alpha: true, browser: null, streams: [[340, 680]], video: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', '40M', '-g', '60', '-auto-alt-ref', '0', '-pix_fmt', 'yuva420p'], audio: ['-c:a', 'libopus', '-b:a', '192k'] },
  { id: 'prores-proxy-mov', label: 'ProRes 422 Proxy 10 位（MOV + PCM 16 位）', container: 'mov', size: UHD, fps: '60', browser: false, streams: [[350, 700]], video: ['-c:v', 'prores_ks', '-profile:v', '0', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'] },
  { id: 'prores-lt-mov', label: 'ProRes 422 LT 10 位 59.94（MOV + PCM 24 位）', container: 'mov', size: UHD, fps: '60000/1001', browser: false, streams: [[360, 720]], video: ['-c:v', 'prores_ks', '-profile:v', '1', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'prores-422-mov', label: 'ProRes 422 10 位（MOV + PCM 32 位浮点）', container: 'mov', size: UHD, fps: '60', browser: false, streams: [[370, 740]], video: ['-c:v', 'prores_ks', '-profile:v', '2', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_f32le'] },
  { id: 'prores-hq-mov', label: 'ProRes 422 HQ 10 位（MOV + PCM 立体声 + 单声道两条流）', container: 'mov', size: UHD, fps: '60', browser: false, streams: [[380, 760], [790]], video: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'prores-4444-alpha-mov', label: 'ProRes 4444 带透明 10 位（MOV + PCM 24 位）', container: 'mov', size: UHD, fps: '60', alpha: true, browser: false, streams: [[390, 780]], video: ['-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0', '-pix_fmt', 'yuva444p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'prores-4444xq-mov', label: 'ProRes 4444 XQ 10 位（MOV + PCM 24 位）', container: 'mov', size: UHD, fps: '60', browser: false, streams: [[400, 800]], video: ['-c:v', 'prores_ks', '-profile:v', '5', '-vendor', 'apl0', '-pix_fmt', 'yuv444p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'dnxhd-185x-mxf', label: 'DNxHD 185x 1080p25 10 位（MXF OP1a + 2 条 PCM 单声道）', container: 'mxf', size: HD, fps: '25', browser: false, streams: [[410], [820]], video: ['-c:v', 'dnxhd', '-b:v', '185M', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'dnxhd-145-mov', label: 'DNxHD 145 1080p29.97 8 位（MOV + PCM 16 位）', container: 'mov', size: HD, fps: '30000/1001', browser: false, streams: [[420, 840]], video: ['-c:v', 'dnxhd', '-b:v', '145M', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s16le'] },
  { id: 'dnxhr-lb-mov', label: 'DNxHR LB 8 位（MOV + PCM 16 位）', container: 'mov', size: UHD, fps: '60', browser: false, streams: [[430, 860]], video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_lb', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s16le'] },
  { id: 'dnxhr-sq-mxf', label: 'DNxHR SQ 8 位 50p（MXF OP1a + 4 条 PCM 单声道）', container: 'mxf', size: UHD, fps: '50', browser: false, streams: [[440], [550], [660], [770]], video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_sq', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'dnxhr-hq-mxf', label: 'DNxHR HQ 8 位（MXF OP1a + PCM 立体声）', container: 'mxf', size: UHD, fps: '60', browser: false, streams: [[450, 900]], video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hq', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'dnxhr-hqx-mov', label: 'DNxHR HQX 10 位（MOV + PCM 24 位）', container: 'mov', size: UHD, fps: '60', browser: false, streams: [[460, 920]], video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'dnxhr-444-mxf', label: 'DNxHR 444 10 位（MXF OP1a + 2 条 PCM 单声道）', container: 'mxf', size: UHD, fps: '60', browser: false, streams: [[470], [940]], video: ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_444', '-pix_fmt', 'yuv444p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'cineform-422-mov', label: 'CineForm 4:2:2 10 位（MOV + PCM 24 位）', container: 'mov', size: UHD, fps: '60', browser: false, streams: [[480, 960]], video: ['-c:v', 'cfhd', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'cineform-rgba-mov', label: 'CineForm RGBA 12 位带透明（MOV，无声）', container: 'mov', size: HD, fps: '60', alpha: true, rgb: true, browser: false, streams: [], video: ['-c:v', 'cfhd', '-pix_fmt', 'gbrap12le'] },
  { id: 'mpeg2-420-ps', label: 'MPEG-2 Main 4:2:0 1080p29.97（MPEG 节目流 + MP2）', container: 'mpg', format: 'vob', size: HD, fps: '30000/1001', browser: false, streams: [[490, 980]], video: ['-c:v', 'mpeg2video', '-b:v', '25M', '-maxrate', '30M', '-bufsize', '9M', '-g', '15', '-bf', '2', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'mp2', '-b:a', '384k'] },
  { id: 'mpeg2-422-mxf', label: 'MPEG-2 4:2:2 Profile 1080p25 50Mbps（MXF OP1a + 4 条 PCM 单声道，XDCAM HD422 式）', container: 'mxf', size: HD, fps: '25', browser: false, streams: [[500], [610], [720], [830]], video: ['-c:v', 'mpeg2video', '-profile:v', '0', '-level:v', '2', '-b:v', '50M', '-maxrate', '50M', '-minrate', '50M', '-bufsize', '17825792', '-g', '12', '-bf', '2', '-pix_fmt', 'yuv422p'], audio: ['-c:a', 'pcm_s24le'] },
  { id: 'mpeg2-420-m2ts-ac3', label: 'MPEG-2 Main 4:2:0 1080p29.97（M2TS + AC-3 5.1）', container: 'm2ts', format: 'mpegts', formatArgs: ['-mpegts_m2ts_mode', '1'], size: HD, fps: '30000/1001', browser: false, streams: [[510, 1020, 1530, 255, 765, 1275]], layout: '5.1', video: ['-c:v', 'mpeg2video', '-b:v', '25M', '-maxrate', '30M', '-bufsize', '9M', '-g', '15', '-bf', '2', '-pix_fmt', 'yuv420p'], audio: ['-c:a', 'ac3', '-b:a', '448k'] },
  { id: 'mjpeg-avi', label: 'Motion JPEG 4:2:2 1080p30（AVI + PCM 16 位）', container: 'avi', size: HD, fps: '30', jpeg: true, browser: false, streams: [[520, 1040]], video: ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj422p'], audio: ['-c:a', 'pcm_s16le'] },
]

const rate = text => { const [num, den = 1] = String(text).split('/').map(Number); return num / den }
const fileOf = sample => path.join(ROOT, `${sample.id}.${sample.container}`)
const codeHeight = sample => sample.size[1] / 9

/** FFmpeg arguments that write `sample` (without the output path). */
function encodeArgs(sample) {
  const [width, height] = sample.size; const band = codeHeight(sample)
  const inputs = ['-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=${sample.fps}:d=${SECONDS}`, '-f', 'lavfi', '-i', `color=c=black:s=${BITS}x1:r=${sample.fps}:d=${SECONDS}`]
  const audioRate = sample.rate ?? 48000
  for (const stream of sample.streams) inputs.push('-f', 'lavfi', '-i', `aevalsrc='${stream.map(tone).join('|')}':s=${audioRate}:d=${SECONDS}${sample.layout ? `:c=${sample.layout}` : ''}`)
  const pixFmt = sample.video[sample.video.indexOf('-pix_fmt') + 1]
  // Bit X of the frame number N across the top ninth, then the colour conversion the tags declare.
  let graph = `[1:v]format=gray,geq=lum='if(bitand(N,pow(2,X)),255,0)',scale=${width}:${band}:flags=neighbor[code];[0:v][code]overlay=0:0`
  if (sample.alpha) {
    const maskInput = 2 + sample.streams.length
    inputs.push('-f', 'lavfi', '-i', `color=c=black:s=3x9:r=${sample.fps}:d=${SECONDS}`)
    graph += `[picture];[${maskInput}:v]format=gray,geq=lum='if(lt(Y,1),255,if(eq(X,0),255,if(eq(X,1),128,0)))',scale=${width}:${height}:flags=neighbor[mask];[picture][mask]alphamerge`
  }
  const convert = sample.rgb ? `format=${pixFmt}` : `scale=out_color_matrix=bt709:out_range=${sample.jpeg ? 'pc' : 'tv'},format=${pixFmt}`
  graph += `,${convert}[v]`
  const maps = ['-map', '[v]', ...sample.streams.flatMap((_, index) => ['-map', `${2 + index}:a`])]
  const tags = sample.rgb ? [] : sample.jpeg ? JPEG_RANGE : BT709
  return [...inputs, '-filter_complex', graph, ...maps, ...sample.video, ...tags, ...(sample.audio ?? []), ...(sample.format ? ['-f', sample.format] : []), ...(sample.formatArgs ?? []), '-t', String(SECONDS)]
}

function probe(file) {
  const { ffprobePath } = require('./mediaBinaries.cjs')
  return JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' }))
}

/** Presentation timestamps (seconds, sorted) of every picture of the first video stream. */
function framePts(file) {
  const { ffprobePath } = require('./mediaBinaries.cjs')
  const data = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time,best_effort_timestamp_time', '-of', 'json', file], { windowsHide: true, encoding: 'utf8', maxBuffer: 2 ** 28 }))
  return data.frames.map(frame => Number(frame.pts_time ?? frame.best_effort_timestamp_time)).filter(Number.isFinite).sort((a, b) => a - b)
}

/** The frame number in the code band of every picture of `file` (decoded by FFmpeg). */
function frameCodes(file, width, height) {
  const { ffmpegPath } = require('./mediaBinaries.cjs')
  const band = Math.round(height / 9)
  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `crop=${width}:${band}:0:0,scale=${BITS}:1:flags=area,format=gray`, '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 2 ** 30 })
  return codesOf(raw, BITS)
}
/** Decodes rows of 16 gray cells (one byte each) into frame numbers with their contrast margin. */
function codesOf(raw, stride) {
  const codes = []
  for (let offset = 0; offset + BITS <= raw.length; offset += stride) {
    let code = 0; let margin = 255
    for (let bit = 0; bit < BITS; bit++) { const value = raw[offset + bit]; if (value > 128) code |= 1 << bit; margin = Math.min(margin, Math.abs(value - 128)) }
    codes.push({ code, margin })
  }
  return codes
}

/** Generates the missing samples (or all with `force`) and checks every one: streams, frame codes 0..n-1. */
function ensureSamples({ only, force = false, log = () => {} } = {}) {
  const { ffmpegPath } = require('./mediaBinaries.cjs')
  fs.mkdirSync(ROOT, { recursive: true })
  const chosen = SAMPLES.filter(sample => !only || only.includes(sample.id))
  assert.ok(chosen.length, `没有匹配的样本：${only}`)
  return chosen.map(sample => {
    const file = fileOf(sample)
    if (force || !fs.existsSync(file)) {
      const partial = `${file}.partial.${sample.container}`
      const started = Date.now()
      execFileSync(ffmpegPath, ['-v', 'error', '-y', ...encodeArgs(sample), partial], { windowsHide: true, stdio: 'pipe', timeout: 1800000 })
      fs.renameSync(partial, file)
      log(`生成 ${sample.id}（${((Date.now() - started) / 1000).toFixed(1)}s）`)
    }
    return describe(sample)
  })
}

/** Facts of a generated sample, checked against its definition. */
function describe(sample) {
  const file = fileOf(sample)
  const facts = probe(file)
  const video = facts.streams.find(stream => stream.codec_type === 'video')
  const audio = facts.streams.filter(stream => stream.codec_type === 'audio')
  assert.equal(video.width, sample.size[0], `${sample.id} 宽度`); assert.equal(video.height, sample.size[1], `${sample.id} 高度`)
  assert.equal(rate(video.r_frame_rate), rate(sample.fps), `${sample.id} 帧率 ${video.r_frame_rate}`)
  assert.deepEqual(audio.map(stream => stream.channels), sample.streams.map(stream => stream.length), `${sample.id} 声音流与设计不符`)
  const pts = framePts(file)
  const codes = frameCodes(file, video.width, video.height)
  assert.deepEqual(codes.map(entry => entry.code), codes.map((_, index) => index), `${sample.id} 帧号条码应为 0..${codes.length - 1}`)
  assert.equal(codes.length, pts.length, `${sample.id} 条码帧数与时间戳数`)
  return {
    ...sample, path: file, bytes: fs.statSync(file).size, probe: facts, audioStreams: audio,
    video: { codec: video.codec_name, profile: video.profile ?? null, pixFmt: video.pix_fmt, width: video.width, height: video.height, fps: rate(video.r_frame_rate), rate: video.r_frame_rate, colorSpace: video.color_space ?? null, colorRange: video.color_range ?? null, frames: pts.length, firstPts: pts[0], pts },
    audio: audio.map(stream => ({ codec: stream.codec_name, channels: stream.channels, layout: stream.channel_layout ?? null, sampleRate: Number(stream.sample_rate), sampleFmt: stream.sample_fmt, startTime: Number(stream.start_time ?? 0) })),
    minCodeMargin: Math.min(...codes.map(entry => entry.margin)),
  }
}

/** Every sound stream decoded by FFmpeg and resampled with soxr to `rate`, on the absolute source timeline. */
function referenceStreams(file, audio, rate = 48000) {
  const { ffmpegPath } = require('./mediaBinaries.cjs')
  return audio.map((stream, index) => {
    const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-map', `0:a:${index}`, '-af', `aresample=${rate}:resampler=soxr:precision=28`, '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 2 ** 30 })
    const offset = Math.max(0, Math.round(Number(stream.startTime ?? stream.start_time ?? 0) * rate)); const frames = raw.length / 4 / stream.channels
    return Array.from({ length: stream.channels }, (_, channel) => {
      const plane = new Float32Array(offset + frames)
      for (let sample = 0; sample < frames; sample++) plane[offset + sample] = raw.readFloatLE((sample * stream.channels + channel) * 4)
      return plane
    })
  })
}

/**
 * FFmpeg reference picture of source frame `index` as 8-bit RGB over black (alpha applied, not premultiplied in the
 * file), converted with the matrix and range the file declares. Returns a raw RGB buffer.
 */
function referencePicture(described, index) {
  const { ffmpegPath } = require('./mediaBinaries.cjs')
  const { width, height, colorSpace, colorRange } = described.video
  const decoder = described.alpha && described.video.codec === 'vp9' ? ['-c:v', 'libvpx-vp9'] : []
  const matrix = colorSpace === 'bt470bg' || colorSpace === 'smpte170m' ? 'bt601' : 'bt709'
  const convert = described.rgb ? '' : `scale=in_color_matrix=${matrix}:in_range=${colorRange === 'pc' ? 'pc' : 'tv'}:out_range=pc:flags=accurate_rnd+full_chroma_int+full_chroma_inp,`
  const raw = execFileSync(ffmpegPath, ['-v', 'error', ...decoder, '-i', described.path, '-map', '0:v:0', '-vf', `select=eq(n\\,${index}),${convert}format=rgba`, '-frames:v', '1', '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 2 ** 28 })
  assert.equal(raw.length, width * height * 4, `${described.id} 参考帧 ${index} 尺寸`)
  const rgb = Buffer.alloc(width * height * 3)
  for (let pixel = 0; pixel < width * height; pixel++) {
    const alpha = described.alpha ? raw[pixel * 4 + 3] / 255 : 1
    for (let channel = 0; channel < 3; channel++) rgb[pixel * 3 + channel] = Math.round(raw[pixel * 4 + channel] * alpha)
  }
  return rgb
}

module.exports = { PICTURE_TOLERANCE_SECONDS, ROOT, SECONDS, SAMPLES, BITS, codeHeight, codesOf, describe, encodeArgs, ensureSamples, fileOf, frameCodes, framePts, probe, referencePicture, referenceStreams, rate }
