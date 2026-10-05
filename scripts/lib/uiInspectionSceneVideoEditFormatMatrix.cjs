const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const matrix = require('./videoEditFormatMatrix.cjs')

/**
 * 专业格式矩阵（任务 3.2）在真实 Electron 中逐格验收。样本由 scripts/lib/videoEditFormatMatrix.cjs 生成（帧号条码、BT.709
 * 标注、每声道不同正弦 + 扫频），每格：
 * - 导入：经界面导入，素材宽高、声音流与 ffprobe 一致，日志记录实际后端（强制浏览器时只有原生能解的格式按格式拒绝、工程不变）；
 * - 放置：项目面板“添加到当前序列”，画面 + 每条声音流一个链接音频片段；序列改为样本自己的尺寸与帧率；
 * - 节目监视器：首帧与另两帧的预览像素对 FFmpeg 参考（按文件标注转换，透明叠在黑底上）PSNR > 24dB、条码为应有源帧；
 *   时间线标尺键盘逐帧（前进 5、后退 3）、正向播放、反向播放、标尺拖动（往返），每次呈现的源时间都是该序列帧应有的源帧；
 *   正向播放记录更新率、遗漏、原生进程平均核数与节目电平；
 * - 源监视器：打开、按秒定位三次落在该时间所在帧、正向播放画面前进（有声素材电平 > 0.01）、反向浏览画面后退；
 * - 导出：整段导出帧数、逐帧条码、预览对导出 PSNR > 24dB、导出混音与 FFmpeg soxr 参考逐声道互相关 ≥ 0.98、时差 < 10ms。
 * 另一阶段 `tripo`：用户素材目录（只读原路径引用）全部视频导入，源监视器逐个播放，素材文件大小与修改时间不变。
 *
 * 诊断变量：HENJI_FORMAT_MATRIX_ONLY=id,id（只跑部分样本，不作为全矩阵结论）、HENJI_FORMAT_MATRIX_PHASES=formats,tripo、
 * HENJI_VIDEO_DECODER=browser|native。证据：node_modules/.cache/video-edit-format-matrix/evidence-<后端>.json。
 */
const ROOT = path.resolve('node_modules/.cache/video-edit-format-matrix')
const TRIPO = 'D:/视频制作/2026-09-19_Tripo/素材'
const RATE = 48000; const MAX_LAG = Math.round(RATE * 0.01)
const ONLY = process.env.HENJI_FORMAT_MATRIX_ONLY ? process.env.HENJI_FORMAT_MATRIX_ONLY.split(',').map(value => value.trim()).filter(Boolean) : null
const PHASES = new Set((process.env.HENJI_FORMAT_MATRIX_PHASES || 'formats,tripo').split(',').map(value => value.trim()))

const button = (scope, name) => scope.getByRole('button', { name, exact: true })
const menuItem = (page, name) => page.getByRole('menuitem', { name, exact: true })
const entry = (page, id) => page.locator(`[data-video-edit-project-entry="${id}"]`)
const readProject = file => JSON.parse(fs.readFileSync(file, 'utf8'))
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
const quantile = (values, q) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * q))] : null
const round = (value, digits = 3) => value === null || value === undefined || !Number.isFinite(value) ? value : Math.round(value * 10 ** digits) / 10 ** digits

async function saved(page, file, matches, message, attempts = 300) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = fs.existsSync(file) ? readProject(file) : null
    if (value && matches(value)) return value
    await page.waitForTimeout(50)
  }
  assert.fail(message)
}

/** Accumulated CPU seconds of the native decoder service processes (null when not running or unreadable). */
function nativeCpuSeconds() {
  try {
    const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', "(Get-Process -Name 'henji-video-decoder' -ErrorAction SilentlyContinue | Measure-Object -Property CPU -Sum).Sum"], { windowsHide: true, encoding: 'utf8', timeout: 30000 })
    const value = Number(output.trim()); return output.trim() && Number.isFinite(value) ? value : null
  } catch { return null }
}

async function logEvents(page, afterTimestamp, names) {
  return page.evaluate(async ({ afterTimestamp, names }) => {
    const result = await window.henjiNative.logging.queryLogEvents({ date: afterTimestamp.slice(0, 10), afterTimestamp, limit: 500 })
    return result.events.filter(event => names.includes(event.event)).map(event => ({ event: event.event, level: event.level, context: event.context, error: event.error?.message ?? event.error }))
  }, { afterTimestamp, names })
}

/** PSNR of two 8-bit RGB buffers of the same size. */
function psnr(left, right) {
  assert.equal(left.length, right.length, 'PSNR 两幅画面尺寸不同')
  let square = 0; for (let index = 0; index < left.length; index++) square += (left[index] - right[index]) ** 2
  return square === 0 ? Infinity : 10 * Math.log10(255 ** 2 / (square / left.length))
}
async function rgbOf(file) { return require('sharp')(file).removeAlpha().raw().toBuffer() }
/** The frame number in the code band of a picture file (top ninth, 16 cells). */
async function pictureCode(file, width, height) {
  const raw = await require('sharp')(file).extract({ left: 0, top: 0, width, height: Math.round(height / 9) }).resize(matrix.BITS, 1, { kernel: 'cubic', fit: 'fill' }).greyscale().raw().toBuffer()
  return matrix.codesOf(raw, matrix.BITS)[0]
}

function correlation(actual, expected, lag, from, to, stride = 1) {
  let ab = 0; let aa = 0; let bb = 0
  for (let index = from; index < to; index += stride) { const a = actual[index]; const b = expected[index - lag] ?? 0; ab += a * b; aa += a * a; bb += b * b }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0
}
/** Best lag within ±10ms and its correlation per output channel over `[from, to)`. */
function compareAudio(actual, expected, from, to) {
  return [0, 1].map(channel => {
    const a = actual[channel]; const b = expected[channel]
    let best = { lag: 0, value: -Infinity }
    for (let lag = -MAX_LAG; lag <= MAX_LAG; lag += 4) { const value = correlation(a, b, lag, from, to, 4); if (value > best.value) best = { lag, value } }
    for (let lag = best.lag - 4; lag <= best.lag + 4; lag++) { const value = correlation(a, b, lag, from, to, 4); if (value > best.value) best = { lag, value } }
    return { channel, bestLagMs: round(best.lag / RATE * 1000, 3), correlation: round(correlation(a, b, best.lag, from, to), 6) }
  })
}

/** What the single-sample sequence must sound like (task 2.6 routing: mono centred at full level, first two channels). */
function expectedMix(sequence, reference, totalSamples, fps) {
  const output = [new Float32Array(totalSamples), new Float32Array(totalSamples)]
  for (const clip of sequence.clips) {
    if (!(clip.kind === 'audio' || (clip.kind === 'video' && clip.sourceComponent !== 'video')) || clip.volume <= 0 || !reference.length) continue
    const plane = (stream, channel) => reference[stream]?.[channel]
    const mapping = clip.audioMapping
    const routes = mapping ? mapping.format === 'mono' ? [plane(mapping.sources[0].stream, mapping.sources[0].channel), plane(mapping.sources[0].stream, mapping.sources[0].channel)] : [plane(mapping.sources[0].stream, mapping.sources[0].channel), plane(mapping.sources[1].stream, mapping.sources[1].channel)]
      : [plane(0, 0), plane(0, Math.min(1, reference[0].length - 1))]
    const first = Math.ceil(clip.start / fps * RATE - 1e-7); const last = Math.min(totalSamples, Math.ceil((clip.start + clip.duration) / fps * RATE - 1e-7))
    const inPoint = (clip.sourceInUs + clip.sourceRemainder.numerator / clip.sourceRemainder.denominator) / 1e6
    for (let s = Math.max(0, first); s < last; s++) {
      const position = Math.floor((inPoint + s / RATE - clip.start / fps) * RATE + 0.5 + 1e-6)
      for (let channel = 0; channel < 2; channel++) { const source = routes[channel]; if (source && position >= 0 && position < source.length) output[channel][s] += source[position] * clip.volume }
    }
  }
  return output
}

/** Observes program presentations (frame + source timestamps) until `stop()`; returns the distinct frames shown. */
async function observeProgram(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    window.__matrixFrames = []
    window.__matrixObserver?.disconnect()
    window.__matrixObserver = new MutationObserver(() => window.__matrixFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), timestamps: canvas.dataset.sourceTimestamps ?? '', scrubbing: canvas.dataset.scrubbing === 'true', decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), renderMs: Number(canvas.dataset.renderMs) }))
    window.__matrixObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame', 'data-source-timestamps'] })
  })
  return async () => {
    const frames = await page.evaluate(() => { window.__matrixObserver.disconnect(); return window.__matrixFrames })
    return frames.filter((value, index) => index === 0 || value.frame !== frames[index - 1].frame || value.timestamps !== frames[index - 1].timestamps)
  }
}
function playbackSummary(frames, fps, direction) {
  if (frames.length < 2) return { updates: frames.length }
  const gaps = frames.slice(1).map((value, index) => value.at - frames[index].at)
  const span = (frames.at(-1).at - frames[0].at) / 1000; const advanced = (frames.at(-1).frame - frames[0].frame) * direction
  const missing = frames.slice(1).reduce((total, value, index) => total + Math.max(0, (value.frame - frames[index].frame) * direction - 1), 0)
  const wrongWay = frames.slice(1).filter((value, index) => (value.frame - frames[index].frame) * direction < 0).length
  return { updates: frames.length, spanSeconds: round(span), updatesPerSecond: round((frames.length - 1) / span, 2), nominalFps: round(fps, 3), framesAdvanced: advanced, missing, wrongWay, clockDeviation: round(Math.abs(advanced / fps - span) / span, 4), p95GapMs: round(quantile(gaps, 0.95), 1), maxGapMs: round(Math.max(...gaps), 1), decodeP95Ms: round(quantile(frames.map(frame => frame.decodeMs).filter(Number.isFinite), 0.95), 1) }
}

function createVideoEditFormatMatrixScene() {
  return {
    id: 'video-edit-format-matrix', surface: '剪辑', name: '剪辑-专业格式矩阵导入预览定位源监视混音导出与用户素材', writesUserData: true,
    setup: async (page, app, { capture }) => {
      fs.mkdirSync(ROOT, { recursive: true })
      const forced = ['native', 'browser'].includes(String(process.env.HENJI_VIDEO_DECODER).toLowerCase()) ? String(process.env.HENJI_VIDEO_DECODER).toLowerCase() : null
      const evidence = { startedAt: new Date().toISOString(), forced, only: ONLY, phases: [...PHASES], samples: [], tripo: null }
      const evidencePath = path.join(ROOT, `evidence-${forced ?? 'auto'}${ONLY ? '-partial' : ''}.json`)
      const store = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
      let client; let previousLayout
      try {
        // Diagnostic only (HENJI_FORMAT_MATRIX_TRACE=1): render-worker requests and responses with timing, kept per worker.
        if (process.env.HENJI_FORMAT_MATRIX_TRACE === '1') await page.evaluate(() => {
          const Native = window.Worker; window.__matrixWorkerTrace = []
          window.Worker = class TracedWorker extends Native {
            constructor(url, options) {
              super(url, options)
              const index = window.__matrixWorkerTrace.length; const log = []; window.__matrixWorkerTrace.push(log)
              const push = entry => { log.push({ at: Math.round(performance.now()), ...entry }); if (log.length > 400) log.shift() }
              const post = this.postMessage.bind(this)
              this.postMessage = (message, transfer) => { const clip = message?.document?.clips?.[0]; push({ dir: 'out', kind: message?.kind, id: message?.id, frame: message?.frame, sequential: message?.sequential, deadline: message?.deadline ? Math.round(message.deadline - performance.timeOrigin) : undefined, revision: message?.revision ?? message?.document?.revision, clip: clip ? { in: clip.sourceInUs, d: clip.duration } : undefined }); return post(message, transfer) }
              this.addEventListener('message', event => { const data = event.data; if (data?.kind === 'log') { push({ dir: 'log', event: data.event, context: data.context }); return } push({ dir: 'in', id: data?.id, presented: data?.presented, hits: data?.cacheHits, cacheBytes: data?.cacheBytes, decodeMs: data?.decodeMs === undefined ? undefined : Math.round(data.decodeMs), ts: data?.sourceTimestamps, error: data?.error }) })
              void index
            }
          }
        })
        const status = await page.evaluate(() => window.henjiNative.videoDecoder.status())
        evidence.decoder = { available: status.available, forced: status.forcedBackend ?? null }
        assert.equal(status.forcedBackend ?? null, forced, '诊断变量未经平台层传到渲染层')
        if (forced !== 'browser') assert.equal(status.available, true, '本机原生解码服务应可用')
        await button(page, '剪辑').first().click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        const identity = await authorizeMcpConnection(page, { name: '格式矩阵验收', allowWrites: true })
        client = await connectMcpClient(identity.config, 'Henji format matrix Reality')
        const projectRef = id => ({ kind: 'video_edit.project', id })
        const playbackOf = async (id, value) => {
          const read = await callTool(client, 'read_application_entity', { ref: projectRef(id), propertyIds: ['video_edit.project.program_playback'] })
          const result = await callTool(client, 'change_application_entities', operationEnvelope([read], { summary: '格式矩阵播放控制', changes: [{ kind: 'set_properties', entityType: 'video_edit.project', target: projectRef(id), properties: { 'video_edit.project.program_playback': value } }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result))
        }
        const alerts = async () => (await page.getByRole('alert').allTextContents()).map(text => text.trim()).filter(Boolean)
        const programPrompt = () => page.evaluate(() => (document.body.innerText.match(/节目画面无法显示[^\n]*\n?[^\n]*/) || [''])[0])

        if (PHASES.has('formats')) {
          const definitions = matrix.SAMPLES.filter(sample => !ONLY || ONLY.includes(sample.id))
          evidence.currentPhase = '生成并核对样本'; store()
          const described = matrix.ensureSamples({ only: definitions.map(sample => sample.id) })
          await page.evaluate(dir => window.henjiNative.media.allowRoot(dir), matrix.ROOT)
          const importFile = path.join(ROOT, `import-${forced ?? 'auto'}-${Date.now()}.henji-video`)
          await dialogs(app, [], importFile); await button(page, '新建项目').click()
          await saved(page, importFile, () => true, '新建工程未保存')

          for (const sample of described) {
            const record = { id: sample.id, label: sample.label, file: sample.path, bytes: sample.bytes, video: { ...sample.video, pts: undefined }, audio: sample.audio, checks: {} }
            try {
            evidence.samples.push(record); evidence.currentPhase = `${sample.id}：导入`; store()
            const reference = sample.audio.length ? matrix.referenceStreams(sample.path, sample.audio, RATE) : []
            const fps = sample.video.fps
            // ---- 导入（每格回到同一个导入工程）
            if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
            await dialogs(app, [importFile], importFile); await button(page, '打开项目文件').click()
            await button(page, '导入').waitFor({ state: 'visible', timeout: 30000 })
            await page.waitForTimeout(300)
            const before = fs.readFileSync(importFile, 'utf8')
            const importedAt = new Date().toISOString()
            await dialogs(app, [sample.path], importFile); await button(page, '导入').click()
            let media
            for (let attempt = 0; attempt < 400 && !media; attempt++) {
              media = readProject(importFile).media.find(item => same(item.path, sample.path))
              if (!media && (await logEvents(page, importedAt, ['video_edit.media.inspect.undecodable'])).length) break
              if (!media) await page.waitForTimeout(50)
            }
            // Renderer logs reach the main-process store asynchronously.
            let inspect = null
            for (let attempt = 0; attempt < 100 && !inspect; attempt++) {
              inspect = (await logEvents(page, importedAt, ['video_edit.media.inspect.completed', 'video_edit.media.inspect.undecodable']))[0] ?? null
              if (!inspect) await page.waitForTimeout(100)
            }
            record.import = { accepted: Boolean(media), log: inspect }
            if (!media) {
              record.import.message = inspect?.error ?? null
              await page.waitForTimeout(300)
              assert.equal(fs.readFileSync(importFile, 'utf8'), before, `${sample.id} 被拒绝后工程不能改变`)
              assert.ok(inspect?.event === 'video_edit.media.inspect.undecodable', `${sample.id} 未导入且没有无法解码日志`)
              assert.doesNotMatch(String(record.import.message), /原生|浏览器|native|browser|mediabunny|webcodecs|ffmpeg/i, '提示不能出现实现名称')
              assert.ok(forced === 'browser' && sample.browser !== true, `${sample.id} 应能导入，实际被拒绝：${record.import.message}`)
              record.result = '按格式拒绝（强制浏览器）'; store()
              continue
            }
            assert.ok(!(forced === 'browser' && sample.browser === false), `${sample.id} 浏览器不能解码，强制浏览器时应拒绝导入`)
            assert.deepEqual({ width: media.width, height: media.height, hasAudio: media.hasAudio === true }, { width: sample.video.width, height: sample.video.height, hasAudio: sample.audio.length > 0 }, `${sample.id} 素材字段与 ffprobe 不一致`)
            if (sample.audio.length) assert.deepEqual((media.audioStreams ?? []).map(stream => stream.channels), sample.audio.map(stream => stream.channels), `${sample.id} 声音流清单与 ffprobe 不一致`)
            assert.ok(Math.abs(media.frameRate.numerator / media.frameRate.denominator - fps) < 1e-3, `${sample.id} 帧率 ${JSON.stringify(media.frameRate)} 与 ffprobe ${sample.video.rate} 不一致`)
            assert.equal(inspect?.event, 'video_edit.media.inspect.completed', `${sample.id} 缺少探测完成日志`)
            if (forced) assert.equal(inspect.context.backend, forced, `${sample.id} 实际后端应为强制后端`)
            record.import = { ...record.import, media: { width: media.width, height: media.height, frameRate: media.frameRate, frameRateMode: media.frameRateMode, durationSeconds: media.durationSeconds, audioStreams: media.audioStreams ?? null }, backend: inspect.context.backend, browserDecodes: inspect.context.browserDecodes, nativeDecodes: inspect.context.nativeDecodes }
            record.checks.import = true; store()

            // ---- 放置（正式“添加到当前序列”），读回后撤销
            evidence.currentPhase = `${sample.id}：放置`; store()
            const imported = readProject(importFile)
            const item = imported.items.find(candidate => candidate.mediaId === media.id)
            const placedBefore = imported.sequences[0].clips.length
            await entry(page, item.id).click(); await entry(page, item.id).click({ button: 'right' }); await menuItem(page, '添加到当前序列').click()
            const placed = await saved(page, importFile, value => value.sequences[0].clips.length > placedBefore, `${sample.id} 放入时间线后未保存`)
            const group = placed.sequences[0].clips.filter(clip => clip.itemId === item.id)
            assert.equal(group.filter(clip => clip.kind === 'video').length, 1, `${sample.id} 应放置一个画面片段`)
            assert.equal(group.filter(clip => clip.kind === 'audio').length, sample.audio.length, `${sample.id} 每条声音流一个音频片段`)
            if (group.length > 1) assert.equal(new Set(group.map(clip => clip.linkId)).size, 1, `${sample.id} 画面与声音片段应链接`)
            const tracks = placed.sequences[0].tracks
            await button(page, '撤销').click()
            await saved(page, importFile, value => value.sequences[0].clips.length === placedBefore, `${sample.id} 撤销放置后未保存`)
            record.placement = group.map(clip => ({ kind: clip.kind, track: clip.track, audioMapping: clip.audioMapping ?? null }))

            // ---- 单样本工程：序列为样本尺寸与帧率
            const offsetUs = Math.ceil(sample.video.firstPts * 1e6)
            const frames = sample.video.frames
            const [num, den] = sample.video.rate.split('/').map(Number)
            const id = `matrix-${sample.id}-${Date.now()}`
            const document = structuredClone(readProject(importFile))
            document.id = id; document.name = `格式矩阵 ${sample.id}`; document.revision = 0
            const sequence = document.sequences[0]
            Object.assign(sequence, { id: `${id}-sequence`, width: sample.video.width, height: sample.video.height, frameRate: { numerator: num, denominator: den || 1 }, tracks: structuredClone(tracks), annotations: [],
              clips: group.map(clip => ({ ...structuredClone(clip), id: `${id}-${clip.id}`, linkId: group.length > 1 ? `${id}-link` : clip.linkId, start: 0, duration: frames, sourceInUs: offsetUs, sourceRemainder: { numerator: 0, denominator: 1 } })) })
            for (const key of ['transitions', 'captions', 'markers']) delete sequence[key]
            if (!group[0].linkId || group.length === 1) sequence.clips.forEach(clip => { if (!clip.linkId) delete clip.linkId })
            const projectFile = path.join(ROOT, `${id}.henji-video`); const output = path.join(ROOT, `${id}.mp4`)
            fs.writeFileSync(projectFile, JSON.stringify(document))
            const pictureTrack = group.find(clip => clip.kind === 'video').track
            const expectedPts = frame => sample.video.pts[frame]
            /** Asserts the program picture of sequence frame `frame` shows source frame `frame` (timestamps from the renderer). */
            const exactAt = (frame, timestamps, label) => {
              const times = String(timestamps).split(',').filter(Boolean).map(Number)
              const expected = expectedPts(frame)
              assert.ok(times.length >= 1 && times.some(time => Math.abs(time - expected) < 2e-4), `${sample.id} ${label}：序列第 ${frame} 帧画出源时间 ${timestamps}，应为 ${expected}`)
            }

            evidence.currentPhase = `${sample.id}：节目监视器`; store()
            if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
            await dialogs(app, [projectFile], output); await button(page, '打开项目文件').click()
            try { await presented(page, 0) } catch (error) { record.failedPrompt = await programPrompt(); await capture(`matrix-${sample.id}-open-failed`); throw error }
            const canvasData = () => page.locator('canvas[aria-label="剪辑画面"]').evaluate(canvas => ({ ...canvas.dataset, width: canvas.width, height: canvas.height }))
            exactAt(0, (await canvasData()).sourceTimestamps, '首帧')
            let backends = []
            for (let attempt = 0; attempt < 50 && !backends.some(context => context?.mediaId === media.id); attempt++) {
              backends = (await logEvents(page, importedAt, ['video_edit.decode.backend.selected'])).map(event => event.context)
              if (!backends.some(context => context?.mediaId === media.id)) await page.waitForTimeout(100)
            }
            record.playbackBackends = [...new Set(backends.filter(context => context?.mediaId === media.id).map(context => context.backend))]
            if (forced) assert.deepEqual(record.playbackBackends, [forced], `${sample.id} 节目实际解码后端应为强制后端`)

            // Pixels against FFmpeg (first, middle, last frame) and the code band of each preview picture.
            const pictureFrames = [0, Math.floor(frames / 2) + 1, frames - 1]
            const previews = {}
            record.pixels = []
            for (const frame of pictureFrames) {
              await playbackOf(id, { frame, playing: false, playbackDirection: 1 }); await presented(page, frame)
              const image = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ base64: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height, timestamps: canvas.dataset.sourceTimestamps }))
              assert.deepEqual([image.width, image.height], [sample.video.width, sample.video.height], `${sample.id} 节目画布应为序列尺寸`)
              exactAt(frame, image.timestamps, `像素帧 ${frame}`)
              previews[frame] = path.join(ROOT, `preview-${sample.id}-${frame}.png`); fs.writeFileSync(previews[frame], Buffer.from(image.base64, 'base64'))
              const value = psnr(await rgbOf(previews[frame]), matrix.referencePicture(sample, frame))
              const code = await pictureCode(previews[frame], image.width, image.height)
              record.pixels.push({ frame, psnrVsFfmpeg: round(value, 2), code: code.code, codeMargin: code.margin })
              assert.ok(value > 24, `${sample.id} 预览第 ${frame} 帧与 FFmpeg 参考不一致：${value}dB`)
              assert.equal(code.code, frame, `${sample.id} 预览第 ${frame} 帧条码为 ${code.code}`)
            }
            record.checks.pixels = true; store()

            // Keyboard frame steps on the timeline ruler: 5 forward from frame 0, then 3 back.
            await playbackOf(id, { frame: 0, playing: false, playbackDirection: 1 }); await presented(page, 0)
            const ruler = page.getByRole('slider', { name: '剪辑时间定位' })
            await ruler.focus()
            record.steps = []
            for (const [key, frame] of [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 3], ['ArrowRight', 4], ['ArrowRight', 5], ['ArrowLeft', 4], ['ArrowLeft', 3], ['ArrowLeft', 2]]) {
              const at = Date.now(); await ruler.press(key); await presented(page, frame)
              exactAt(frame, (await canvasData()).sourceTimestamps, `逐帧 ${key}`)
              record.steps.push({ key, frame, ms: Date.now() - at })
            }
            record.checks.step = true

            // Forward playback from frame 0 (formal program playback control), then reverse from the end. Each run starts
            // from the paused start frame; the start-up latency (command → first new picture) is reported separately and
            // the rates are measured from the first new picture on.
            const playRun = async (from, direction, ms, onTick) => {
              await playbackOf(id, { frame: from, playing: false, playbackDirection: 1 }); await presented(page, from)
              const stopObserving = await observeProgram(page)
              const commandAt = await page.evaluate(() => performance.now()); const began = Date.now()
              await playbackOf(id, { frame: from, playing: true, playbackDirection: direction })
              while (Date.now() - began < ms) { await page.waitForTimeout(100); if (onTick) await onTick() }
              const values = (await stopObserving()).filter(value => value.at >= commandAt && value.frame !== from && value.frame < frames)
              const elapsed = (Date.now() - began) / 1000
              await playbackOf(id, { frame: from, playing: false, playbackDirection: 1 }); await presented(page, from)
              return { values, elapsed, startupMs: values.length ? round(values[0].at - commandAt, 1) : null }
            }
            const cpuBefore = nativeCpuSeconds()
            let peak = 0
            const forwardRun = await playRun(0, 1, Math.max(1000, Math.round((frames - 10) / fps * 1000)), async () => {
              if (sample.audio.length) peak = Math.max(peak, ...await page.getByLabel('节目播放电平', { exact: true }).locator('[data-video-edit-level-channel]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.peak))).catch(() => [0]))
            })
            const cpuAfter = nativeCpuSeconds()
            for (const value of forwardRun.values) exactAt(value.frame, value.timestamps, '正向播放')
            record.forward = { ...playbackSummary(forwardRun.values, fps, 1), startupMs: forwardRun.startupMs, nativeCores: cpuBefore === null || cpuAfter === null ? null : round((cpuAfter - cpuBefore) / forwardRun.elapsed, 2), levelPeak: sample.audio.length ? round(peak, 3) : null }
            assert.ok(record.forward.updates >= Math.min(20, frames / 3), `${sample.id} 正向播放画面没有持续前进：${JSON.stringify(record.forward)}`)
            assert.equal(record.forward.wrongWay, 0, `${sample.id} 正向播放画面倒退`)
            if (sample.audio.length) assert.ok(peak > 0.01, `${sample.id} 正向播放节目电平应有声音：${peak}`)
            record.checks.forward = true

            const reverseRun = await playRun(frames - 1, -1, Math.max(1000, Math.round((frames - 10) / fps * 1000 * 0.8)))
            for (const value of reverseRun.values) exactAt(value.frame, value.timestamps, '反向播放')
            record.reverse = { ...playbackSummary(reverseRun.values, fps, -1), startupMs: reverseRun.startupMs }
            assert.ok(record.reverse.updates >= 10, `${sample.id} 反向播放画面没有持续后退：${JSON.stringify(record.reverse)}`)
            assert.equal(record.reverse.wrongWay, 0, `${sample.id} 反向播放画面前进：${JSON.stringify(reverseRun.values.map(value => value.frame))}`)
            record.checks.reverse = true; store()

            // Ruler drag (scrub): from frame 2 to near the end and back, over 1.5s each, then settle.
            const zoom = Number(await page.getByLabel('时间线缩放', { exact: true }).inputValue())
            const pixels = 60 * zoom / fps
            const box = await ruler.boundingBox()
            const to = Math.max(4, Math.min(frames - 3, Math.floor((box.width - 12) / pixels)))
            record.scrub = []
            for (const [from, target] of [[2, to], [to, 2]]) {
              await playbackOf(id, { frame: from, playing: false, playbackDirection: 1 }); await presented(page, from)
              await page.mouse.move(box.x + from * pixels + pixels / 2, box.y + 12); await page.mouse.down()
              const stop = await observeProgram(page); const started = Date.now()
              const steps = Math.abs(target - from)
              for (let index = 1; index <= steps; index++) {
                const frame = from + Math.sign(target - from) * index
                await page.mouse.move(box.x + frame * pixels + pixels / 2, box.y + 12)
                const delay = started + 1500 * index / steps - Date.now(); if (delay > 0) await page.waitForTimeout(delay)
              }
              await page.mouse.up()
              await page.waitForFunction(frame => { const canvas = document.querySelector('canvas[aria-label="剪辑画面"]'); return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing !== 'true' }, target, { timeout: 60000 })
              const shown = await stop()
              for (const value of shown.filter(value => value.frame < frames)) exactAt(value.frame, value.timestamps, `拖动 ${from}→${target}`)
              const during = shown.filter(value => value.at - shown[0]?.at <= 1500)
              record.scrub.push({ from, to: target, presentations: shown.length, perSecond: round(during.length / 1.5, 1), maxGapMs: shown.length > 1 ? round(Math.max(...shown.slice(1).map((value, index) => value.at - shown[index].at)), 1) : null })
              assert.ok(shown.length >= Math.min(10, steps / 2), `${sample.id} 拖动 ${from}→${target} 只呈现 ${shown.length} 次`)
            }
            record.checks.scrub = true
            assert.equal(await programPrompt(), '', `${sample.id} 节目监视器出现失败提示`)
            store()

            // ---- 源监视器
            evidence.currentPhase = `${sample.id}：源监视器`; store()
            const opened = readProject(projectFile); const sourceItem = opened.items.find(candidate => candidate.mediaId === media.id)
            const openedAt = Date.now(); await entry(page, sourceItem.id).dblclick()
            await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready' && (document.querySelector('[data-video-edit-source-canvas]')?.dataset.presentedTimeUs !== undefined || document.querySelector('[data-video-edit-source-host] video')?.readyState >= 2), null, { timeout: 30000 })
            const sourceTime = () => page.evaluate(() => { const canvas = document.querySelector('[data-video-edit-source-canvas]'); if (canvas) return { mode: 'render', us: Number(canvas.dataset.presentedTimeUs) }; const video = document.querySelector('[data-video-edit-source-host] video'); return { mode: 'element', us: Math.round((video?.currentTime ?? NaN) * 1e6) } })
            record.source = { openMs: Date.now() - openedAt, mode: (await sourceTime()).mode, seeks: [] }
            const duration = frames / fps
            for (const seconds of [0.5, Math.min(duration - 0.2, 2.25), 0.1].map(value => round(value + sample.video.firstPts, 6))) {
              const field = page.getByLabel('源素材定位秒', { exact: true })
              const at = Date.now(); await field.fill(String(seconds)); await field.press('Enter')
              await page.waitForFunction(time => {
                const canvas = document.querySelector('[data-video-edit-source-canvas]'); const video = document.querySelector('[data-video-edit-source-host] video')
                const presented = canvas ? Number(canvas.dataset.presentedTimeUs) / 1e6 : video?.currentTime
                return document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready' && presented <= time.at + time.tolerance + 1e-6 && presented > time.at - 0.5
              }, { at: seconds, tolerance: matrix.PICTURE_TOLERANCE_SECONDS }, { timeout: 30000 })
              const value = await sourceTime()
              if (value.mode === 'render') assert.ok(value.us / 1e6 <= seconds + matrix.PICTURE_TOLERANCE_SECONDS + 1e-6 && value.us / 1e6 > seconds - 1.5 / fps, `${sample.id} 源定位 ${seconds}s 落在 ${value.us}µs，不是该时间所在的帧`)
              record.source.seeks.push({ seconds, presentedUs: value.us, ms: Date.now() - at })
            }
            const sourceSamples = async (ms, audible) => {
              await page.evaluate(() => {
                window.__matrixSource = []; const read = () => { const canvas = document.querySelector('[data-video-edit-source-canvas]'); const video = document.querySelector('[data-video-edit-source-host] video'); return canvas ? Number(canvas.dataset.presentedTimeUs) : Math.round((video?.currentTime ?? 0) * 1e6) }
                window.__matrixSourceTimer = setInterval(() => { const time = read(); if (window.__matrixSource.at(-1)?.time !== time) window.__matrixSource.push({ at: performance.now(), time }) }, 4)
              })
              let maxPeak = 0
              for (let tick = 0; tick < ms / 100; tick++) {
                await page.waitForTimeout(100)
                if (audible) maxPeak = Math.max(maxPeak, ...await page.getByLabel('源播放电平', { exact: true }).locator('[data-video-edit-level-channel]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.peak))).catch(() => [0]))
              }
              const values = await page.evaluate(() => { clearInterval(window.__matrixSourceTimer); return window.__matrixSource })
              return { values, maxPeak }
            }
            const sourcePanel = page.locator('[data-video-edit-panel="source"]').first()
            await button(page, '播放源素材').click()
            // 2.4 seconds: heavy software-decoded formats (4K CineForm, ProRes 4444) take about a second to open the playback
            // path; the start-up is reported separately and the rate is measured from the first new picture.
            const forward = await sourceSamples(2400, sample.audio.length > 0)
            await button(sourcePanel, '停止').click().catch(() => button(page, '暂停源素材').click())
            // Rate from the first new picture on (the first sample is the paused picture before playback started).
            const moving = forward.values.slice(1); const span = moving.length > 1 ? (moving.at(-1).at - moving[0].at) / 1000 : 0
            record.source.forward = { startupMs: moving.length ? round(moving[0].at - forward.values[0].at, 1) : null, updates: forward.values.length, updatesPerSecond: span ? round((moving.length - 1) / span, 1) : 0, advancedUs: forward.values.length ? forward.values.at(-1).time - forward.values[0].time : 0, backwards: forward.values.filter((value, index) => index && value.time < forward.values[index - 1].time).length, levelPeak: sample.audio.length ? round(forward.maxPeak, 3) : null }
            assert.ok(record.source.forward.updates >= 8, `${sample.id} 源监视器正向播放画面没有持续前进：${JSON.stringify(record.source.forward)}`)
            assert.equal(record.source.forward.backwards, 0, `${sample.id} 源监视器正向播放画面倒退`)
            if (sample.audio.length) assert.ok(forward.maxPeak > 0.01, `${sample.id} 源监视器应出声：${forward.maxPeak}`)
            await button(sourcePanel, '反向（静音）').click()
            // 1.8 seconds: reverse browsing first builds its render session and decodes the GOP before stepping back.
            const backward = await sourceSamples(1800, false)
            await button(sourcePanel, '停止').click()
            record.source.reverse = { updates: backward.values.length, forwards: backward.values.filter((value, index) => index && value.time > backward.values[index - 1].time).length, movedUs: backward.values.length ? backward.values[0].time - backward.values.at(-1).time : 0 }
            assert.ok(record.source.reverse.updates >= 4 && record.source.reverse.movedUs > 0, `${sample.id} 源监视器反向浏览画面没有后退：${JSON.stringify(record.source.reverse)}`)
            assert.equal(record.source.reverse.forwards, 0, `${sample.id} 源监视器反向浏览画面前进`)
            record.checks.source = true
            await capture(`matrix-${sample.id}`)
            await button(page, '关闭源素材').click()
            store()

            // ---- 导出
            evidence.currentPhase = `${sample.id}：导出`; store()
            const exportedAt = new Date().toISOString(); const exportCpu = nativeCpuSeconds(); const exportStart = performance.now()
            await button(page, '导出视频').click()
            await page.getByRole('button', { name: /^取消导出/ }).waitFor({ state: 'visible', timeout: 15000 })
            await button(page, '导出视频').waitFor({ state: 'visible', timeout: 600000 })
            const exportMs = performance.now() - exportStart; const exportCpuAfter = nativeCpuSeconds()
            const task = (await callTool(client, 'query_video_edit_export', { projectRef: projectRef(id) })).data.task
            const exportLog = (await page.evaluate(async afterTimestamp => (await window.henjiNative.logging.queryLogEvents({ date: afterTimestamp.slice(0, 10), afterTimestamp, domainPrefix: 'features.videoEdit.export', limit: 50 })).events.filter(event => /^video_edit\.export\.(completed|failed|cancelled)$/.test(event.event)).map(event => ({ event: event.event, context: event.context, error: event.error })), exportedAt))[0] ?? null
            record.export = { state: task.state, ms: round(exportMs, 0), nativeCores: exportCpu === null || exportCpuAfter === null ? null : round((exportCpuAfter - exportCpu) / (exportMs / 1000), 2), log: exportLog, alerts: await alerts() }
            assert.equal(task.state, 'completed', `${sample.id} 导出失败：${JSON.stringify(record.export)}`)
            const facts = matrix.probe(output); const exportedVideo = facts.streams.find(stream => stream.codec_type === 'video')
            assert.equal(Number(exportedVideo.nb_frames), frames, `${sample.id} 导出帧数`)
            assert.deepEqual([exportedVideo.width, exportedVideo.height], [sample.video.width, sample.video.height])
            const codes = matrix.frameCodes(output, exportedVideo.width, exportedVideo.height)
            const wrong = codes.map((value, index) => ({ index, actual: value.code, margin: value.margin })).filter(value => value.actual !== value.index)
            assert.deepEqual(wrong.slice(0, 10), [], `${sample.id} 导出每一帧应是应有的源帧（帧号条码）`)
            record.export.frames = codes.length; record.export.minCodeMargin = Math.min(...codes.map(value => value.margin))
            record.export.previewPsnr = []
            for (const frame of pictureFrames) {
              const exported = path.join(ROOT, `export-${sample.id}-${frame}.png`)
              execFileSync(require('./mediaBinaries.cjs').ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', `select=eq(n\\,${frame}),format=rgb24`, '-frames:v', '1', exported], { windowsHide: true })
              const value = psnr(await rgbOf(previews[frame]), await rgbOf(exported))
              record.export.previewPsnr.push({ frame, psnr: round(value, 2) })
              assert.ok(value > 24, `${sample.id} 预览与导出第 ${frame} 帧不一致：${value}dB`)
            }
            if (reference.length) {
              const raw = execFileSync(require('./mediaBinaries.cjs').ffmpegPath, ['-v', 'error', '-i', output, '-vn', '-ac', '2', '-ar', String(RATE), '-f', 'f32le', '-'], { windowsHide: true, maxBuffer: 2 ** 30 })
              const total = raw.length / 8; const planes = [new Float32Array(total), new Float32Array(total)]
              for (let index = 0; index < total; index++) { planes[0][index] = raw.readFloatLE(index * 8); planes[1][index] = raw.readFloatLE(index * 8 + 4) }
              const expected = expectedMix(readProject(projectFile).sequences[0], reference, total, fps)
              record.export.audio = compareAudio(planes, expected, MAX_LAG + Math.round(RATE * 0.05), Math.min(total, Math.floor(frames / fps * RATE)) - MAX_LAG - Math.round(RATE * 0.05))
              for (const channel of record.export.audio) {
                assert.ok(channel.correlation >= 0.98, `${sample.id} 导出混音声道 ${channel.channel} 相关 ${channel.correlation}`)
                assert.ok(Math.abs(channel.bestLagMs) < 10, `${sample.id} 导出混音声道 ${channel.channel} 时差 ${channel.bestLagMs}ms`)
              }
            }
            record.checks.export = true
            record.result = '通过'
            if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
            store()
            console.log(`[video-edit-format-matrix] ${sample.id} ${JSON.stringify({ backend: record.import.backend, psnr: record.pixels.map(value => value.psnrVsFfmpeg), forward: record.forward.updatesPerSecond, cores: record.forward.nativeCores, reverse: record.reverse.updatesPerSecond, source: record.source.forward.updatesPerSecond, exportMs: record.export.ms, audio: record.export.audio?.map(value => value.correlation) })}`)
            } catch (error) {
              // Forced browser, formats Chromium only partly handles (expectation not fixed): record and continue.
              if (!(forced === 'browser' && sample.browser === null)) throw error
              record.result = `浏览器后备未通过：${String(error?.message ?? error).split(/\r?\n/)[0].slice(0, 200)}`; store()
              await button(page, '关闭源素材').click({ timeout: 5000 }).catch(() => {})
              if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
            }
          }
          // Back to the import project to leave a clean state.
          evidence.formatsCompleted = true; store()
        }

        if (PHASES.has('tripo') && fs.existsSync(TRIPO)) {
          evidence.currentPhase = 'Tripo 用户素材'; store()
          const files = fs.readdirSync(TRIPO).filter(name => /\.(mp4|mov|mkv|mxf|webm)$/i.test(name)).map(name => path.join(TRIPO, name)).filter(file => fs.statSync(file).isFile()).sort()
          const stamp = Object.fromEntries(files.map(file => { const stat = fs.statSync(file); return [file, { size: stat.size, mtimeMs: stat.mtimeMs }] }))
          const tripoFile = path.join(ROOT, `tripo-${forced ?? 'auto'}-${Date.now()}.henji-video`)
          if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
          await page.evaluate(dir => window.henjiNative.media.allowRoot(dir), TRIPO)
          await dialogs(app, [], tripoFile); await button(page, '新建项目').click(); await saved(page, tripoFile, () => true, 'Tripo 工程未保存')
          const importedAt = Date.now()
          await dialogs(app, files, tripoFile); await button(page, '导入').click()
          const project = await saved(page, tripoFile, value => value.media.length === files.length, `Tripo 素材未全部导入（${files.length} 个）`, 2400)
          evidence.tripo = { files: files.length, importMs: Date.now() - importedAt, items: [] }
          for (const file of files) {
            const media = project.media.find(item => same(item.path, file))
            assert.ok(media, `${path.basename(file)} 未导入`)
            assert.ok(same(media.path, file), `${path.basename(file)} 应原路径引用`)
          }
          store()
          for (const file of files) {
            const media = project.media.find(item => same(item.path, file)); const item = project.items.find(candidate => candidate.mediaId === media.id)
            const fps = media.frameRate.numerator / media.frameRate.denominator
            // The project list is virtualized: filter it to this file so its entry exists.
            await page.getByLabel('搜索项目素材', { exact: true }).fill(item.name ?? media.name)
            const openedAt = Date.now(); await entry(page, item.id).dblclick()
            await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready' && (document.querySelector('[data-video-edit-source-canvas]')?.dataset.presentedTimeUs !== undefined || document.querySelector('[data-video-edit-source-host] video')?.readyState >= 2), null, { timeout: 60000 })
            const openMs = Date.now() - openedAt
            const middle = round(media.durationSeconds / 2, 3)
            const field = page.getByLabel('源素材定位秒', { exact: true }); await field.fill(String(middle)); await field.press('Enter')
            await page.waitForFunction(time => { const canvas = document.querySelector('[data-video-edit-source-canvas]'); const video = document.querySelector('[data-video-edit-source-host] video'); const presented = canvas ? Number(canvas.dataset.presentedTimeUs) / 1e6 : video?.currentTime; return document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready' && presented <= time.at + time.tolerance + 1e-6 && presented > time.at - 0.5 }, { at: middle, tolerance: matrix.PICTURE_TOLERANCE_SECONDS }, { timeout: 60000 })
            await page.evaluate(() => {
              window.__tripoSource = []; const read = () => { const canvas = document.querySelector('[data-video-edit-source-canvas]'); const video = document.querySelector('[data-video-edit-source-host] video'); return canvas ? Number(canvas.dataset.presentedTimeUs) : Math.round((video?.currentTime ?? 0) * 1e6) }
              window.__tripoTimer = setInterval(() => { const time = read(); if (window.__tripoSource.at(-1)?.time !== time) window.__tripoSource.push({ at: performance.now(), time }) }, 4)
            })
            const playedAt = new Date().toISOString()
            await button(page, '播放源素材').click()
            let peak = 0
            // 3 seconds: starting mid-file in long-GOP 4K material decodes from the key frame first (start-up reported separately).
            for (let tick = 0; tick < 30; tick++) { await page.waitForTimeout(100); if (media.hasAudio) peak = Math.max(peak, ...await page.getByLabel('源播放电平', { exact: true }).locator('[data-video-edit-level-channel]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.peak))).catch(() => [0])) }
            const values = await page.evaluate(() => { clearInterval(window.__tripoTimer); return window.__tripoSource })
            await button(page, '暂停源素材').click().catch(() => {})
            const moving = values.slice(1); const span = moving.length > 1 ? (moving.at(-1).at - moving[0].at) / 1000 : 0
            // Native picture sessions opened by the play start: one schedule session positions and decodes the GOP once (task 3.6 F1;
            // before, a sequential reader session decoded it first and the schedule session again).
            const playbackSessions = (await logEvents(page, playedAt, ['video_decoder.native.decode.session.opened'])).filter(event => event.context?.purpose === 'Playback').length
            const result = { file: path.basename(file), width: media.width, height: media.height, fps: round(fps, 3), durationSeconds: round(media.durationSeconds, 3), hasAudio: media.hasAudio === true, openMs, startupMs: moving.length ? round(moving[0].at - values[0].at, 1) : null, secondMs: moving.length > 1 ? round(moving[1].at - values[0].at, 1) : null, startGapMs: moving.length > 1 ? round(Math.max(...moving.slice(1, 30).map((value, index) => value.at - moving[index].at)), 1) : null, updates: values.length, updatesPerSecond: span ? round((moving.length - 1) / span, 1) : 0, backwards: values.filter((value, index) => index && value.time < values[index - 1].time).length, levelPeak: media.hasAudio ? round(peak, 3) : null, playbackSessions }
            evidence.tripo.items.push(result); store()
            assert.ok(result.updates >= 8, `${result.file} 源监视器播放画面没有持续前进：${JSON.stringify(result)}`)
            assert.equal(result.backwards, 0, `${result.file} 源监视器播放画面倒退`)
            assert.ok(result.playbackSessions <= 1, `${result.file} 起播打开了 ${result.playbackSessions} 个原生播放会话（应只有播放计划一个，3.6 F1）`)
            if (media.hasAudio) assert.ok(peak > 0.001, `${result.file} 有声素材源监视器应出声：${peak}`)
            if (/透明/.test(result.file)) await capture('matrix-tripo-prores4444')
            await button(page, '关闭源素材').click()
          }
          await page.getByLabel('搜索项目素材', { exact: true }).fill('')
          for (const file of files) { const stat = fs.statSync(file); assert.deepEqual({ size: stat.size, mtimeMs: stat.mtimeMs }, stamp[file], `${path.basename(file)} 不能被改动`) }
          evidence.tripo.unchanged = true
          await capture('matrix-tripo-project')
          if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
          store()
        }
        evidence.completed = true; delete evidence.currentPhase; store()
        console.log(`[video-edit-format-matrix] ${JSON.stringify({ forced, passed: evidence.samples.filter(sample => sample.result === '通过').map(sample => sample.id).length, refused: evidence.samples.filter(sample => sample.import && !sample.import.accepted).map(sample => sample.id), tripo: evidence.tripo ? evidence.tripo.items.length : null })}`)
      } catch (error) {
        evidence.failed = { phase: evidence.currentPhase, message: String(error?.message ?? error), stack: error?.stack }; store()
        // Diagnosis: the app's own warnings/errors since the scene began and the source monitor state at failure.
        evidence.failed.logs = await page.evaluate(async afterTimestamp => (await window.henjiNative.logging.queryLogEvents({ date: afterTimestamp.slice(0, 10), afterTimestamp, limit: 500 })).events.filter(event => event.level === 'warn' || event.level === 'error' || /source|reverse|decode\.native|fallback/.test(event.event)).slice(-80).map(event => ({ at: event.timestamp, level: event.level, event: event.event, context: event.context, error: event.error?.message ?? event.error })), evidence.startedAt).catch(failure => String(failure))
        evidence.failed.recentLogs = await page.evaluate(async () => { const after = new Date(Date.now() - 20000).toISOString(); return (await window.henjiNative.logging.queryLogEvents({ date: after.slice(0, 10), afterTimestamp: after, limit: 400 })).events.map(event => ({ at: event.timestamp, level: event.level, domain: event.domain, event: event.event, context: event.context, error: event.error?.message ?? event.error })) }).catch(failure => String(failure))
        evidence.failed.workerTrace = await page.evaluate(() => window.__matrixWorkerTrace?.map(log => log.slice(-150))).catch(() => null)
        evidence.failed.frameStats = await page.evaluate(() => window.henjiNative.videoFrames?.stats()).catch(failure => String(failure))
        evidence.failed.sourceState = await page.evaluate(() => ({ status: document.querySelector('[data-video-edit-source-status]')?.dataset, canvas: document.querySelector('[data-video-edit-source-canvas]')?.dataset, text: document.querySelector('[data-video-edit-panel="source"]')?.innerText?.slice(0, 400) })).catch(() => null)
        store()
        await capture('format-matrix-failed').catch(() => {})
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

module.exports = { createVideoEditFormatMatrixScene }
