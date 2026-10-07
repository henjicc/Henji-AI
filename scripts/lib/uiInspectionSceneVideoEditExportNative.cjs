const { confirmVideoEditExport } = require('./uiInspectionVideoEditExportDialog.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { adoptNewVideoEditProject, chooseVideoEditImportFiles, openVideoEditFile, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

/**
 * 导出接入与预览一致性（2.4）在真实 Electron 中的闭环：
 * - 样本（场景自己生成，4K60，2.5 秒）：ProRes 422 HQ MOV（PCM 立体声）、DNxHR HQX MXF（4 条 PCM 单声道）、ProRes 4444
 *   透明叠加层（无声）、H.264 + AAC（与浏览器后端对照）。每个画面顶部 240 像素是 16 位帧号条码（FFmpeg geq 的 N），
 *   导出后逐帧解出条码，就能确认每一帧都是应有的源帧（无缺帧、重复帧、透明替代）。
 * - 每种格式经“导入 → 添加到当前序列”得到正式放置（画面 + 每条声音流一个链接音频片段），改写为 2 秒（一个片段）与
 *   10 秒（5 个不同入点的片段，同一文件的剪辑点）两种 3840×2160 60fps 工程，经界面导出：帧数、逐帧条码、2 秒工程的
 *   预览与导出逐帧 PSNR（>24dB，与 engine-probe 同一标准）、导出混音与 FFmpeg soxr 参考互相关（≥0.98、时差 <10ms）、
 *   导出耗时与原生进程 CPU（Get-Process 累计 CPU 秒）。
 * - ProRes 4444 叠加：透明区域显示底层（条码仍可解出）、不透明块与半透明带与 FFmpeg overlay 参考一致。
 * - 入出点范围导出与取消（专业格式工程）。
 * - 精确帧或失败（帧通道端口代理，不改正式代码）：导出会话的连续计划丢掉几帧时由单帧读取补上，成片逐帧条码仍正确；
 *   再让单帧读取失败时导出停在该帧、以用户语言提示并删除半成品。
 * `HENJI_VIDEO_DECODER=browser` 时只跑 H.264（浏览器后端对照耗时）。证据：node_modules/.cache/video-edit-export-native/evidence.json。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-export-native')
const WIDTH = 3840; const HEIGHT = 2160; const FPS = 60; const SOURCE_SECONDS = 2.5; const RATE = 48000
const CODE_BITS = 16; const CODE_HEIGHT = 240
const MAX_LAG = Math.round(RATE * 0.01)
const PREVIEW_FRAMES = [0, 59, 60, 119]
/** Source in-points (µs, whole source frames) of the five clips of the 10-second projects: cuts jump inside one file. */
const IN_POINTS = [400_000, 0, 250_000, 100_000, 300_000]
const CLIP_FRAMES = 2 * FPS
// A tone plus a chirp per channel: aperiodic, so the cross-correlation has one peak (multitrack scene's signal).
const tone = frequency => `0.2*sin(2*PI*${frequency}*t)+0.1*sin(2*PI*(${frequency * 2 + 37}+${50 + frequency / 10}*t)*t)`
const sound = channels => ['-f', 'lavfi', '-i', `aevalsrc='${channels.map(tone).join('|')}':s=${RATE}:d=${SOURCE_SECONDS}`]
const PICTURE = ['-f', 'lavfi', '-i', `testsrc2=s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${SOURCE_SECONDS}`, '-f', 'lavfi', '-i', `color=c=black:s=${CODE_BITS}x1:r=${FPS}:d=${SOURCE_SECONDS}`]
// Bit X of the frame number N, white or black, scaled to 240-pixel cells across the top of the picture.
const CODED = `[1:v]format=gray,geq=lum='if(bitand(N,pow(2,X)),255,0)',scale=${WIDTH}:${CODE_HEIGHT}:flags=neighbor[code];[0:v][code]overlay=0:0[v]`
const SAMPLES = [
  { key: 'prores', file: 'prores422hq-4k60.mov', label: 'ProRes 422 HQ', native: true, streams: [[330, 550]], args: [...PICTURE, ...sound([330, 550]), '-filter_complex', CODED, '-map', '[v]', '-map', '2:a', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le'] },
  { key: 'dnxhr', file: 'dnxhr-hqx-4k60.mxf', label: 'DNxHR HQX（MXF）', native: true, streams: [[220], [440], [660], [880]], args: [...PICTURE, ...sound([220]), ...sound([440]), ...sound([660]), ...sound([880]), '-filter_complex', CODED, '-map', '[v]', '-map', '2:a', '-map', '3:a', '-map', '4:a', '-map', '5:a', '-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le'] },
  { key: 'h264', file: 'h264-4k60.mp4', label: 'H.264', native: false, streams: [[260, 520]], args: [...PICTURE, ...sound([260, 520]), '-filter_complex', CODED, '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', String(FPS), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k'] },
]
// Transparent everywhere but an opaque white block moving 24px a frame and a half-transparent black band (drawn on a
// 96×54 grid of 40px cells, then scaled up); the code band at the top stays visible through it.
const OVERLAY_BOX = 'between(X,mod(N*0.6,76),mod(N*0.6,76)+19)*between(Y,30,44)'
const OVERLAY = { key: 'alpha', file: 'prores4444-alpha-4k60.mov', label: 'ProRes 4444 透明', args: ['-f', 'lavfi', '-i', `color=c=black:s=96x54:r=${FPS}:d=${SOURCE_SECONDS},format=yuva444p,geq=lum='if(${OVERLAY_BOX},235,16)':cb=128:cr=128:a='if(${OVERLAY_BOX},255,if(between(Y,46,51),128,0))',scale=${WIDTH}:${HEIGHT}:flags=neighbor,format=yuva444p10le`, '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le'] }
/** Frames of the export-session plan the proxy drops (lost on the way), and the one dropped before the failing read. */
const DROPPED_SOURCE_FRAMES = [30, 31, 75]
const FAILING_SOURCE_FRAME = 45

const button = (scope, name) => scope.getByRole('button', { name, exact: true })
const menuItem = (page, name) => page.getByRole('menuitem', { name, exact: true })
const entry = (page, id) => page.locator(`[data-video-edit-project-entry="${id}"]`)
// 3.1：剪辑是项目里的文档文件，按旧工程形状读出（夹具路径读它对应的实际剪辑）
const readProject = readVideoEditFile
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
const range = (from, to) => Array.from({ length: to - from }, (_, index) => from + index)
const ffmpeg = (args, timeout = 900000) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, stdio: 'pipe', timeout })
const probe = file => JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' }))

async function saved(page, file, matches, message, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = readProject(file)
    if (matches(value)) return value
    await page.waitForTimeout(50)
  }
  assert.fail(message)
}

/** The frame number in the code band of every picture of a video (16 cells averaged to one gray value each). */
function frameCodes(file) {
  const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-vf', `crop=${WIDTH}:${CODE_HEIGHT}:0:0,scale=${CODE_BITS}:1:flags=area,format=gray`, '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
  const codes = []
  for (let offset = 0; offset + CODE_BITS <= raw.length; offset += CODE_BITS) {
    let code = 0; let margin = 255
    for (let bit = 0; bit < CODE_BITS; bit++) { const value = raw[offset + bit]; if (value > 128) code |= 1 << bit; margin = Math.min(margin, Math.abs(value - 128)) }
    codes.push({ code, margin })
  }
  return codes
}

/** Every sound stream decoded by FFmpeg and resampled with soxr at 48kHz, on the absolute source timeline. */
function referenceStreams(file, audio) {
  return audio.map((stream, index) => {
    const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-map', `0:a:${index}`, '-af', `aresample=${RATE}:resampler=soxr:precision=28`, '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 256 * 1024 * 1024 })
    const offset = Math.max(0, Math.round(Number(stream.start_time ?? 0) * RATE)); const frames = raw.length / 4 / stream.channels
    return Array.from({ length: stream.channels }, (_, channel) => {
      const plane = new Float32Array(offset + frames)
      for (let index = 0; index < frames; index++) plane[offset + index] = raw.readFloatLE((index * stream.channels + channel) * 4)
      return plane
    })
  })
}

function prepare(definitions) {
  fs.mkdirSync(ROOT, { recursive: true })
  return Object.fromEntries(definitions.map(sample => {
    const file = path.join(ROOT, sample.file)
    if (!fs.existsSync(file)) {
      const partial = `${file}.partial${path.extname(file)}`
      ffmpeg([...sample.args, '-t', String(SOURCE_SECONDS), partial]); fs.renameSync(partial, file)
    }
    const facts = probe(file)
    const audio = facts.streams.filter(stream => stream.codec_type === 'audio')
    if (sample.streams) assert.deepEqual(audio.map(stream => stream.channels), sample.streams.map(stream => stream.length), `${sample.file} 声音流与设计不符`)
    return [sample.key, { ...sample, path: file, probe: facts, audio, reference: audio.length ? referenceStreams(file, audio) : [] }]
  }))
}

/** The project's sequence as 3840×2160 at 60fps with the given clips (and the tracks the placement created). */
function variant(base, id, name, tracks, clips) {
  const document = structuredClone(base)
  document.id = id; document.name = name; document.revision = 0
  const sequence = document.sequences[0]
  Object.assign(sequence, { id: `${id}-sequence`, width: WIDTH, height: HEIGHT, frameRate: { numerator: FPS, denominator: 1 }, tracks: structuredClone(tracks), clips, annotations: [] })
  delete sequence.transitions; delete sequence.captions; delete sequence.markers
  return document
}

/** `count` copies of a placed clip group (picture + linked sound clips), one after another, each at its own in-point. */
function groups(group, inPoints, prefix) {
  return inPoints.flatMap((sourceInUs, index) => group.map(clip => ({ ...structuredClone(clip), id: `${prefix}-${index}-${clip.id}`, linkId: `${prefix}-link-${index}`, start: index * CLIP_FRAMES, duration: CLIP_FRAMES, sourceInUs, sourceRemainder: { numerator: 0, denominator: 1 } })))
}

/** Source frame shown by the picture clip on `track` at each sequence frame of `[from, to)`. */
function expectedCodes(sequence, track, from, to) {
  return range(from, to).map(frame => {
    const clip = sequence.clips.find(clip => clip.kind === 'video' && clip.track === track && frame >= clip.start && frame < clip.start + clip.duration)
    if (!clip) return null
    const seconds = (clip.sourceInUs + clip.sourceRemainder.numerator / clip.sourceRemainder.denominator) / 1e6 + (frame - clip.start) / FPS
    return Math.floor(seconds * FPS + 1e-6)
  })
}

/** What the sequence must sound like (task 2.6 routing: mono clips centred at full level, volume, mute/solo off). */
function expectedMix(project, sequence, samples, totalSamples, offsetFrames = 0) {
  const output = [new Float32Array(totalSamples), new Float32Array(totalSamples)]
  for (const clip of sequence.clips) {
    if (!(clip.kind === 'audio' || (clip.kind === 'video' && clip.sourceComponent !== 'video')) || clip.volume <= 0) continue
    const media = project.media.find(media => media.id === project.items.find(item => item.id === clip.itemId)?.mediaId)
    const sample = Object.values(samples).find(value => same(value.path, media.path))
    if (!sample.reference.length) continue // a silent picture (the transparent overlay)
    const plane = (stream, channel) => sample.reference[stream]?.[channel]
    const mapping = clip.audioMapping
    const routes = mapping ? mapping.format === 'mono' ? [plane(mapping.sources[0].stream, mapping.sources[0].channel), plane(mapping.sources[0].stream, mapping.sources[0].channel)] : [plane(mapping.sources[0].stream, mapping.sources[0].channel), plane(mapping.sources[1].stream, mapping.sources[1].channel)]
      : [plane(0, 0), plane(0, Math.min(1, sample.reference[0].length - 1))]
    const first = Math.ceil((clip.start - offsetFrames) / FPS * RATE - 1e-7); const last = Math.min(totalSamples, Math.ceil((clip.start + clip.duration - offsetFrames) / FPS * RATE - 1e-7))
    const inPoint = (clip.sourceInUs + clip.sourceRemainder.numerator / clip.sourceRemainder.denominator) / 1e6
    for (let s = Math.max(0, first); s < last; s++) {
      const position = Math.floor((inPoint + s / RATE - (clip.start - offsetFrames) / FPS) * RATE + 0.5 + 1e-6)
      for (let channel = 0; channel < 2; channel++) { const source = routes[channel]; if (source && position >= 0 && position < source.length) output[channel][s] += source[position] * clip.volume }
    }
  }
  return output
}

function correlation(actual, expected, lag, from, to, stride = 1) {
  let ab = 0; let aa = 0; let bb = 0
  for (let index = from; index < to; index += stride) { const a = actual[index]; const b = expected[index - lag] ?? 0; ab += a * b; aa += a * a; bb += b * b }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}
/** Best lag within ±10ms and its correlation, per channel, over one clip window (edges excluded by the lag window). */
function compareAudio(actual, expected, from, to) {
  return [0, 1].map(channel => {
    const a = actual[channel]; const b = expected[channel]
    let best = { lag: 0, value: -Infinity }
    for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 4) { const value = correlation(a, b, lag, from, to, 4); if (value > best.value) best = { lag, value } }
    for (let lag = best.lag - 4; lag <= best.lag + 4; lag++) { const value = correlation(a, b, lag, from, to, 4); if (value > best.value) best = { lag, value } }
    return { channel, bestLagSamples: best.lag, bestLagMs: best.lag / RATE * 1000, correlation: correlation(a, b, best.lag, from, to) }
  })
}

async function psnr(a, b) {
  const sharp = require('sharp'); const size = await sharp(a).metadata()
  const [left, right] = await Promise.all([sharp(a).removeAlpha().raw().toBuffer(), sharp(b).resize(size.width, size.height).removeAlpha().raw().toBuffer()])
  let square = 0; for (let index = 0; index < left.length; index++) square += (left[index] - right[index]) ** 2
  return square === 0 ? Infinity : 10 * Math.log10(255 ** 2 / (square / left.length))
}

/** Accumulated CPU seconds of the native decoder service processes (null when it is not running or unreadable). */
function nativeCpuSeconds() {
  try {
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', "(Get-Process -Name 'henji-video-decoder' -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum"], { windowsHide: true, encoding: 'utf8', timeout: 30000 })
    const value = Number(output.trim()); return output.trim() && Number.isFinite(value) ? value : null
  } catch { return null }
}

/**
 * Proxies the next frame channel the page connects (the export session's): frames of its sequential plans at the listed
 * source frames are handed straight back as if lost on the way, and optionally every single-frame read fails. The real
 * channel, the preload and the native service are untouched; nothing changes in production code.
 */
async function armChannelFault(page, plan) {
  await page.evaluate(plan => {
    const state = window.__henjiExportFault ??= { installed: false }
    Object.assign(state, { armed: true, plan, route: null, dropped: [], frameAtRequests: 0, frameAtFailed: 0, purposes: {}, pending: {} })
    if (state.installed) return
    state.installed = true
    const proxied = new WeakSet()
    window.addEventListener('message', event => {
      const data = event.data; const real = event.ports?.[0]
      if (proxied.has(event) || data?.type !== 'henji:video-frames-port' || !real || !state.armed) return
      state.armed = false; state.route = data.route
      event.stopImmediatePropagation()
      const channel = new MessageChannel(); const worker = channel.port1
      const transfers = message => [message?.frame, message?.result?.data].filter(value => value instanceof VideoFrame || value instanceof ArrayBuffer)
      worker.onmessage = ({ data: message }) => {
        if (message?.type === 'request' && message.call?.method === 'frameAt') {
          state.frameAtRequests++
          if (state.plan.failFrameAt) { state.frameAtFailed++; worker.postMessage({ type: 'response', id: message.id, error: '注入：单帧读取失败' }); return }
        }
        if (message?.type === 'request' && message.call?.method === 'openDecoder') state.pending[message.id] = message.call.params.purpose
        real.postMessage(message, transfers(message))
      }
      real.onmessage = ({ data: message }) => {
        if (message?.type === 'response' && message.id in state.pending) { if (message.result?.streamId) state.purposes[message.result.streamId] = state.pending[message.id]; delete state.pending[message.id] }
        const meta = message?.type === 'frame' ? message.meta : undefined
        const sourceFrame = meta ? Math.round((meta.ptsUs ?? meta.timestampUs) * 60 / 1e6) : -1
        if (meta?.request?.kind === 'schedule' && state.purposes[meta.streamId] === 'playback' && state.plan.drop.includes(sourceFrame) && !state.dropped.includes(sourceFrame)) {
          state.dropped.push(sourceFrame)
          real.postMessage({ type: 'release', frame: message.frame, token: message.token }, [message.frame])
          return
        }
        worker.postMessage(message, transfers(message))
      }
      const forwarded = new MessageEvent('message', { data, ports: [channel.port2] })
      proxied.add(forwarded); window.dispatchEvent(forwarded)
    }, true)
  }, plan)
}
const faultState = page => page.evaluate(() => { const { armed, route, dropped, frameAtRequests, frameAtFailed, purposes } = window.__henjiExportFault ?? {}; return { armed, route, dropped, frameAtRequests, frameAtFailed, purposes } })

function createVideoEditExportNativeScene() {
  return {
    id: 'video-edit-export-native', surface: '剪辑', name: '剪辑-原生专业格式导出逐帧精确、与预览一致、精确帧或失败', writesUserData: true,
    // The failing single-frame read stops one export on purpose; every other error still fails the scene.
    expectedLogEvents: ['video_edit.export.failed'],
    setup: async (page, app, { capture }) => {
      fs.mkdirSync(ROOT, { recursive: true })
      const evidence = { startedAt: new Date().toISOString(), cases: [], phases: [] }
      const store = () => fs.writeFileSync(path.join(ROOT, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      let client; let previousLayout
      try {
        const status = await page.evaluate(() => window.henjiNative.videoDecoder.status())
        const browserOnly = status.forcedBackend === 'browser'
        evidence.decoder = { available: status.available, forced: status.forcedBackend ?? null }
        if (!browserOnly) assert.equal(status.available, true, '本机原生解码服务应可用')
        phase('生成样本（帧号条码）与 FFmpeg 参考')
        const samples = prepare([...SAMPLES.filter(sample => !browserOnly || !sample.native), ...(browserOnly ? [] : [OVERLAY])])
        for (const sample of Object.values(samples)) {
          if (sample.key === OVERLAY.key) continue
          const codes = frameCodes(sample.path)
          assert.deepEqual(codes.map(entry => entry.code), range(0, SOURCE_SECONDS * FPS), `${sample.file} 的帧号条码应为 0..${SOURCE_SECONDS * FPS - 1}`)
        }
        evidence.samples = Object.values(samples).map(sample => ({ file: sample.path, bytes: fs.statSync(sample.path).size, video: sample.probe.streams.filter(stream => stream.codec_type === 'video').map(stream => ({ codec: stream.codec_name, profile: stream.profile, pixFmt: stream.pix_fmt, width: stream.width, height: stream.height, rate: stream.r_frame_rate })), audio: sample.audio.map(stream => ({ codec: stream.codec_name, channels: stream.channels, sampleRate: Number(stream.sample_rate) })) }))
        store()
        await page.evaluate(dir => window.henjiNative.media.allowRoot(dir), ROOT)

        phase('导入并经“添加到当前序列”得到正式放置')
        await button(page, '剪辑').click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        // The default dock layout (project panel visible), as the multitrack scene does; restored afterwards.
        previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        const importFile = path.join(ROOT, `import-${Date.now()}.henji-video`)
        await dialogs(app, Object.values(samples).map(sample => sample.path), importFile)
        await button(page, '新建项目').click(); await adoptNewVideoEditProject(page, importFile); await chooseVideoEditImportFiles(page)
        const imported = await saved(page, importFile, value => value.media.length === Object.keys(samples).length, '样本未全部导入')
        const identity = await authorizeMcpConnection(page, { name: '导出验收', allowWrites: true })
        client = await connectMcpClient(identity.config, 'Henji export Reality')
        const itemOf = sample => { const media = imported.media.find(media => same(media.path, sample.path)); return imported.items.find(item => item.mediaId === media.id) }
        const placements = {}
        for (const sample of Object.values(samples)) {
          const before = readProject(importFile).sequences[0].clips.length
          await entry(page, itemOf(sample).id).click(); await entry(page, itemOf(sample).id).click({ button: 'right' }); await menuItem(page, '添加到当前序列').click()
          const placed = await saved(page, importFile, value => value.sequences[0].clips.length > before, `${sample.file} 放入时间线后未保存`)
          placements[sample.key] = { tracks: placed.sequences[0].tracks, group: placed.sequences[0].clips.filter(clip => clip.itemId === itemOf(sample).id) }
          const picture = placements[sample.key].group.filter(clip => clip.kind === 'video')
          assert.equal(picture.length, 1, `${sample.file} 应放置一个画面片段`)
          assert.equal(placements[sample.key].group.filter(clip => clip.kind === 'audio').length, sample.audio.length, `${sample.file} 每条声音流一个音频片段`)
          await button(page, '撤销').click()
          await saved(page, importFile, value => value.sequences[0].clips.length === before, `${sample.file} 撤销放置后未保存`)
        }
        const base = readProject(importFile)
        evidence.placements = Object.fromEntries(Object.entries(placements).map(([key, value]) => [key, value.group.map(clip => ({ kind: clip.kind, track: clip.track, sourceComponent: clip.sourceComponent ?? null, audioMapping: clip.audioMapping ?? null }))]))
        store()

        const projectRef = id => ({ kind: 'video_edit.document', id })
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const change = async (ref, properties) => {
          const result = await callTool(client, 'change_application_entities', operationEnvelope([await read(ref, Object.keys(properties))], { summary: '导出验收', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result))
        }
        const alerts = async () => (await page.getByRole('alert').allTextContents()).map(text => text.trim()).filter(Boolean)
        const open = async (document, output) => {
          if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
          const file = path.join(ROOT, `${document.id}.henji-video`); fs.writeFileSync(file, JSON.stringify(document))
          await dialogs(app, [file], output); await openVideoEditFile(page, file); await presented(page, 0)
          return file
        }
        const previewFrames = async (document, frames) => {
          const files = {}
          for (const frame of frames) {
            await change(projectRef(document.id), { 'video_edit.document.program_playback': { frame, playing: false, playbackDirection: 1 } })
            await presented(page, frame)
            const image = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ base64: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height }))
            assert.equal(image.width, WIDTH); assert.equal(image.height, HEIGHT)
            files[frame] = path.join(ROOT, `preview-${document.id}-${frame}.png`); fs.writeFileSync(files[frame], Buffer.from(image.base64, 'base64'))
          }
          return files
        }
        /** Exports through the toolbar; returns wall time, native CPU seconds and the export log of this run. */
        const exportUi = async (document, output, { cancelAt } = {}) => {
          const startedAt = new Date().toISOString(); const cpuBefore = nativeCpuSeconds(); const metricsBefore = await app.evaluate(({ app }) => app.getAppMetrics())
          const started = performance.now()
          await confirmVideoEditExport(page)
          await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible', timeout: 15000 })
          if (cancelAt !== undefined) {
            await page.waitForFunction(percent => { const node = [...document.querySelectorAll('button')].find(button => /^取消导出/.test(button.textContent ?? '')); return node && Number(/(\d+)%/.exec(node.textContent)?.[1] ?? 0) >= percent }, cancelAt, { timeout: 120000 })
            await page.getByRole('button', { name: /^取消导出/ }).click()
          }
          await button(page, '导出视频').waitFor({ state: 'visible', timeout: 600000 })
          const ms = performance.now() - started; const cpuAfter = nativeCpuSeconds(); const metricsAfter = await app.evaluate(({ app }) => app.getAppMetrics())
          const task = (await callTool(client, 'query_video_edit_export', { documentRef: projectRef(document.id) })).data.task
          const logs = await page.evaluate(async afterTimestamp => (await window.henjiNative.logging.queryLogEvents({ date: afterTimestamp.slice(0, 10), afterTimestamp, domainPrefix: 'features.videoEdit.export', limit: 50 })).events.filter(event => /^video_edit\.export\.(completed|failed|cancelled)$/.test(event.event)).map(event => ({ event: event.event, context: event.context, error: event.error })), startedAt)
          const cpu = (metrics, type) => metrics.filter(metric => metric.type === type).reduce((sum, metric) => sum + (metric.cpu?.cumulativeCPUUsage ?? 0), 0)
          return { ms, task, log: logs[0] ?? null, nativeCpuSeconds: cpuBefore === null || cpuAfter === null ? null : cpuAfter - cpuBefore, nativeCores: cpuBefore === null || cpuAfter === null ? null : (cpuAfter - cpuBefore) / (ms / 1000), rendererCpuSeconds: cpu(metricsAfter, 'Tab') - cpu(metricsBefore, 'Tab'), gpuCpuSeconds: cpu(metricsAfter, 'GPU') - cpu(metricsBefore, 'GPU'), alerts: await alerts() }
        }
        /** Frame count, every frame's source frame (code band), and the sound against the reference, for `[from, to)`. */
        const verify = (document, output, track, from, to, label) => {
          const facts = probe(output); const video = facts.streams.find(stream => stream.codec_type === 'video'); const audio = facts.streams.find(stream => stream.codec_type === 'audio')
          assert.equal(Number(video.nb_frames), to - from, `${label} 帧数`); assert.equal(video.width, WIDTH); assert.equal(video.height, HEIGHT)
          const codes = frameCodes(output); const expected = expectedCodes(document.sequences[0], track, from, to)
          const wrong = codes.map((entry, index) => ({ index, frame: from + index, expected: expected[index], actual: entry.code, margin: entry.margin })).filter(entry => entry.expected !== entry.actual)
          assert.deepEqual(wrong.slice(0, 10), [], `${label} 每一帧应是应有的源帧（帧号条码）`)
          assert.ok(Math.min(...codes.map(entry => entry.margin)) > 40, `${label} 帧号条码对比度不足`)
          const raw = execFileSync(ffmpegPath, ['-v', 'error', '-i', output, '-vn', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 1024 * 1024 * 1024 })
          const frames = raw.length / 8; const planes = [new Float32Array(frames), new Float32Array(frames)]
          for (let index = 0; index < frames; index++) { planes[0][index] = raw.readFloatLE(index * 8); planes[1][index] = raw.readFloatLE(index * 8 + 4) }
          const reference = expectedMix(document, document.sequences[0], samples, frames, from)
          const windows = [...new Set(document.sequences[0].clips.filter(clip => clip.kind === 'audio' && clip.start < to && clip.start + clip.duration > from).map(clip => clip.start))].sort((a, b) => a - b).map(start => {
            const end = Math.min(to, start + CLIP_FRAMES); const first = Math.max(start, from)
            return { start, results: compareAudio(planes, reference, Math.ceil((first - from) / FPS * RATE) + MAX_LAG, Math.min(frames, Math.ceil((end - from) / FPS * RATE)) - MAX_LAG) }
          })
          for (const window of windows) for (const channel of window.results) {
            assert.ok(channel.correlation >= 0.98, `${label} 第 ${window.start} 帧起声道 ${channel.channel} 相关 ${channel.correlation}`)
            assert.ok(Math.abs(channel.bestLagMs) < 10, `${label} 第 ${window.start} 帧起声道 ${channel.channel} 时差 ${channel.bestLagMs}ms`)
          }
          return { frames: Number(video.nb_frames), duration: Number(facts.format.duration), audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels } : null, minCodeMargin: Math.min(...codes.map(entry => entry.margin)), audioWindows: windows }
        }
        const pictureTrack = key => placements[key].group.find(clip => clip.kind === 'video').track

        for (const sample of SAMPLES.filter(sample => samples[sample.key])) {
          const { tracks, group } = placements[sample.key]
          for (const seconds of [2, 10]) {
            phase(`${sample.label} ${seconds} 秒导出`)
            const id = `export-${sample.key}-${seconds}s-${Date.now()}`
            const document = variant(base, id, `${sample.label} ${seconds} 秒导出验收`, tracks, groups(group, seconds === 2 ? [0] : IN_POINTS, id))
            const output = path.join(ROOT, `${id}.mp4`)
            await open(document, output)
            const previews = seconds === 2 ? await previewFrames(document, PREVIEW_FRAMES) : {}
            const run = await exportUi(document, output)
            assert.equal(run.task.state, 'completed', `${sample.label} ${seconds} 秒导出失败：${JSON.stringify(run)}`)
            const verified = verify(document, output, pictureTrack(sample.key), 0, seconds * FPS, `${sample.label} ${seconds} 秒`)
            const comparisons = []
            for (const [frame, preview] of Object.entries(previews)) {
              const exported = path.join(ROOT, `export-${id}-${frame}.png`); ffmpeg(['-i', output, '-vf', `select=eq(n\\,${frame}),format=rgb24`, '-frames:v', '1', exported])
              const value = await psnr(preview, exported); comparisons.push({ frame: Number(frame), psnr: value })
              assert.ok(value > 24, `${sample.label} 预览与导出第 ${frame} 帧不一致：${value}dB`)
            }
            evidence.cases.push({ format: sample.label, seconds, output, exportMs: run.ms, log: run.log, nativeCpuSeconds: run.nativeCpuSeconds, nativeCores: run.nativeCores, rendererCpuSeconds: run.rendererCpuSeconds, gpuCpuSeconds: run.gpuCpuSeconds, previewPsnr: comparisons, ...verified })
            store()
            if (seconds === 2) await capture(`export-native-${sample.key}`)
          }
        }
        evidence.phases.push('各格式 2 秒/10 秒导出逐帧条码正确、预览一致、混音互相关通过')

        if (!browserOnly) {
          phase('ProRes 4444 透明叠加导出')
          const { tracks, group } = placements.prores
          const id = `export-alpha-${Date.now()}`
          const background = groups(group, [0], id)
          const overlayPicture = { ...structuredClone(placements.alpha.group[0]), id: `${id}-overlay`, linkId: undefined, track: pictureTrack('prores') + 1, start: 0, duration: CLIP_FRAMES, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
          delete overlayPicture.linkId
          const document = variant(base, id, 'ProRes 4444 透明叠加导出验收', tracks, [...background, overlayPicture])
          const output = path.join(ROOT, `${id}.mp4`)
          await open(document, output)
          const previews = await previewFrames(document, PREVIEW_FRAMES)
          const run = await exportUi(document, output)
          assert.equal(run.task.state, 'completed', `透明叠加导出失败：${JSON.stringify(run)}`)
          const verified = verify(document, output, pictureTrack('prores'), 0, CLIP_FRAMES, '透明叠加')
          const comparisons = []
          for (const frame of PREVIEW_FRAMES) {
            const exported = path.join(ROOT, `export-${id}-${frame}.png`); ffmpeg(['-i', output, '-vf', `select=eq(n\\,${frame}),format=rgb24`, '-frames:v', '1', exported])
            const reference = path.join(ROOT, `reference-${id}-${frame}.png`)
            // The samples carry no colour tags; the app reads them as BT.709 limited range (WebCodecs default), so the
            // reference converts the same way (FFmpeg's own default would be BT.601, about 24dB off everywhere).
            ffmpeg(['-i', samples.prores.path, '-i', samples.alpha.path, '-filter_complex', `[0:v][1:v]overlay=0:0:format=auto,select=eq(n\\,${frame}),scale=in_color_matrix=bt709:in_range=tv,format=rgb24`, '-frames:v', '1', reference])
            const previewPsnr = await psnr(previews[frame], exported); const referencePsnr = await psnr(reference, exported)
            // Mean luma of the regions the overlay defines: opaque block, half-transparent band, fully transparent area.
            const boxX = Math.floor((frame * 0.6) % 76) * 40
            const regions = { opaque: { left: boxX + 40, top: 1240, width: 680, height: 520 }, half: { left: 40, top: 1880, width: WIDTH - 80, height: 160 }, transparent: { left: 40, top: 400, width: WIDTH - 80, height: 700 } }
            const mean = async (file, region) => { const pixels = await require('sharp')(file).extract(region).greyscale().raw().toBuffer(); return pixels.reduce((sum, value) => sum + value, 0) / pixels.length }
            const levels = {}
            for (const [name, region] of Object.entries(regions)) levels[name] = { exported: await mean(exported, region), reference: await mean(reference, region) }
            comparisons.push({ frame, previewPsnr, referencePsnr, levels })
            assert.ok(previewPsnr > 24, `透明叠加预览与导出第 ${frame} 帧不一致：${previewPsnr}dB`)
            assert.ok(referencePsnr > 24, `透明叠加与 FFmpeg overlay 参考第 ${frame} 帧不一致：${referencePsnr}dB`)
            for (const [name, level] of Object.entries(levels)) assert.ok(Math.abs(level.exported - level.reference) < 6, `透明叠加第 ${frame} 帧${name}区域亮度 ${level.exported} 与参考 ${level.reference} 不符`)
            assert.ok(levels.opaque.exported > 225, `不透明块应为白色：${levels.opaque.exported}`)
          }
          evidence.overlay = { output, exportMs: run.ms, log: run.log, nativeCpuSeconds: run.nativeCpuSeconds, comparisons, ...verified }
          store(); await capture('export-native-alpha-overlay')
          evidence.phases.push('ProRes 4444 透明叠加：底层条码逐帧正确，与预览和 FFmpeg 参考一致')

          phase('专业格式工程的入出点范围导出与取消')
          {
            const { tracks: proresTracks, group: proresGroup } = placements.prores
            const rangeId = `export-range-${Date.now()}`
            const document = variant(base, rangeId, 'ProRes 范围导出验收', proresTracks, groups(proresGroup, IN_POINTS, rangeId))
            const output = path.join(ROOT, `${rangeId}.mp4`)
            await open(document, output)
            const ref = projectRef(rangeId)
            const view = (await read(ref, ['video_edit.document.timeline_view'])).data.properties['video_edit.document.timeline_view']
            await change(ref, { 'video_edit.document.timeline_view': { ...view, inFrame: 100, outFrame: 261 } })
            const run = await exportUi(document, output)
            assert.equal(run.task.state, 'completed', JSON.stringify(run))
            const verified = verify(document, output, pictureTrack('prores'), 100, 261, '范围导出（跨两个剪辑点）')
            const cancelled = path.join(ROOT, `${rangeId}-cancelled.mp4`)
            await change(ref, { 'video_edit.document.timeline_view': { ...view, inFrame: null, outFrame: null } })
            await dialogs(app, [], cancelled)
            const cancel = await exportUi(document, cancelled, { cancelAt: 20 })
            assert.equal(cancel.task.state, 'cancelled'); assert.equal(fs.existsSync(cancelled), false, '取消后不应留下未完成文件')
            evidence.range = { output, exportMs: run.ms, ...verified, cancel: { state: cancel.task.state, removed: true } }
            store()
          }
          evidence.phases.push('范围导出逐帧正确（跨剪辑点），取消删除半成品')

          phase('精确帧或失败：导出会话丢帧由单帧读取补上')
          {
            const { tracks: proresTracks, group: proresGroup } = placements.prores
            const id = `export-lost-${Date.now()}`
            const document = variant(base, id, '导出丢帧补帧验收', proresTracks, groups(proresGroup, [0], id))
            const output = path.join(ROOT, `${id}.mp4`)
            await open(document, output)
            await armChannelFault(page, { drop: DROPPED_SOURCE_FRAMES, failFrameAt: false })
            const run = await exportUi(document, output)
            const fault = await faultState(page)
            assert.equal(run.task.state, 'completed', `丢帧后导出应由单帧读取补上并完成：${JSON.stringify({ run, fault })}`)
            assert.deepEqual([...fault.dropped].sort((a, b) => a - b), DROPPED_SOURCE_FRAMES, `代理应丢掉导出连续计划的这些帧：${JSON.stringify(fault)}`)
            assert.ok(fault.frameAtRequests >= DROPPED_SOURCE_FRAMES.length, `丢掉的帧应由单帧读取补上：${JSON.stringify(fault)}`)
            assert.ok((run.log?.context?.singleFrameReads ?? 0) >= DROPPED_SOURCE_FRAMES.length, `导出日志应记录单帧读取次数：${JSON.stringify(run.log)}`)
            const verified = verify(document, output, pictureTrack('prores'), 0, CLIP_FRAMES, '丢帧补帧导出')
            evidence.lostFrames = { output, fault, exportMs: run.ms, log: run.log, ...verified }
            store()
          }
          evidence.phases.push('导出连续计划丢帧时由单帧读取补上，成片逐帧条码仍正确')

          phase('精确帧或失败：单帧读取也失败时导出停在该帧并删除半成品')
          {
            const { tracks: proresTracks, group: proresGroup } = placements.prores
            const id = `export-fail-${Date.now()}`
            const document = variant(base, id, '导出取帧失败验收', proresTracks, groups(proresGroup, [0], id))
            const output = path.join(ROOT, `${id}.mp4`)
            await open(document, output)
            await armChannelFault(page, { drop: [FAILING_SOURCE_FRAME], failFrameAt: true })
            const run = await exportUi(document, output)
            const fault = await faultState(page)
            evidence.failure = { output, fault, task: run.task, log: run.log, alerts: run.alerts }
            store()
            assert.equal(run.task.state, 'failed', `单帧读取失败时导出应失败：${JSON.stringify(run)}`)
            assert.equal(fs.existsSync(output), false, '失败后不应留下未完成文件')
            assert.ok(fault.frameAtFailed >= 1, JSON.stringify(fault))
            const message = `导出在 00:00:00:${String(FAILING_SOURCE_FRAME).padStart(2, '0')} 处停止。素材「${path.basename(samples.prores.path)}」取不到准确的画面：`
            assert.ok(run.alerts.some(text => text.includes(message)), `界面应提示序列位置、素材与原因：${JSON.stringify(run.alerts)}`)
            assert.ok(JSON.stringify(run.log?.error ?? '').includes(message), `失败日志应带同一原因：${JSON.stringify(run.log)}`)
            assert.ok(!run.alerts.some(text => /henji-media|注入|streamId/i.test(text)), '提示不得暴露内部信息')
            assert.equal(run.log?.event, 'video_edit.export.failed'); assert.equal(run.log?.context?.frame, FAILING_SOURCE_FRAME)
            await capture('export-native-frame-failure')
          }
          evidence.phases.push('单帧读取也失败时导出停在该帧、提示用户语言原因并删除半成品')
        }
        evidence.completed = true; delete evidence.currentPhase; store()
      } catch (error) {
        evidence.failed = { message: String(error?.message ?? error), stack: error?.stack }; store()
        await capture('export-native-failed').catch(() => {})
        throw error
      } finally {
        if (client) await client.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        await page.evaluate(previous => { if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1'); else if (typeof previous === 'string') localStorage.setItem('henji.videoEdit.dockLayout.v1', previous) }, previousLayout).catch(() => {})
        store()
      }
    },
  }
}

module.exports = { createVideoEditExportNativeScene }
