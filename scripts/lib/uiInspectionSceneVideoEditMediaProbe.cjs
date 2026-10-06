const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { PICTURE_TOLERANCE_SECONDS } = require('./videoEditFormatMatrix.cjs')

/**
 * 剪辑素材探测（2.1）与专业格式导入（2.2）：原生探测优先、浏览器兜底在真实 Electron 中的结果。
 * - 原生服务经平台层 probe 的元数据与同版本 ffprobe（与服务链接的同一份 FFmpeg 构建）逐字段一致；
 * - 原生播放接通（2.2）后，只有原生能解的专业格式可以导入：素材字段只有现有字段，元数据来自原生探测并与 ffprobe 一致，
 *   日志记录实际播放后端为原生；诊断强制浏览器时仍按具体格式拒绝、工程不变；
 * - 这些素材在源监视器中不用媒体元素：渲染会话出画面、定位到请求时间所在的真实帧、正向播放画面持续前进；
 * - H.264+AAC 照常导入（元数据来自浏览器探测）；原生声音接通（2.3 阶段 B）前，浏览器能完整解码的文件实际播放后端为浏览器，
 *   诊断强制原生时为原生；
 * - 诊断变量 HENJI_VIDEO_DECODER=browser|native 的行为（按本次进程环境断言）；
 * - 2.1 改动前由应用保存的旧工程打开无迁移（文件逐字节不变）、能出画面。
 */
const button = (page, name) => page.getByRole('button', { name, exact: true })
const ROOT = path.resolve('node_modules/.cache/video-edit-media-probe')
const SAMPLES = path.resolve('node_modules/.cache/native-decode')
const FFPROBE = path.join(require('./mediaBinaries.cjs').binDir, 'ffprobe.exe')
const { adoptNewVideoEditProject, leaveVideoEditProject, openVideoEditFile, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const TRIPO_4444 = 'D:/视频制作/2026-09-19_Tripo/素材/010_荷花_高细节_独立透明缓转_v2.mov'
const PROFESSIONAL = [
  { file: path.join(SAMPLES, 'prores422hq.mov'), label: 'Apple ProRes HQ，10 位 4:2:2' },
  { file: path.join(SAMPLES, 'dnxhr_hqx.mov'), label: 'Avid DNxHR HQX，10 位 4:2:2' },
  { file: path.join(SAMPLES, 'dnxhr_hq.mxf'), label: 'Avid DNxHR HQ，8 位 4:2:2' },
  { file: path.join(SAMPLES, 'mpeg2.mpg'), label: 'MPEG-2 Main，8 位 4:2:0' },
  { file: TRIPO_4444, label: 'Apple ProRes 4444，12 位 4:4:4，带透明', optional: true },
]
const CONTROL = path.join(SAMPLES, 'h264_aac.mp4')
/**
 * Projects saved by the app before 2.1 (local evidence, frozen once): `legacy/<name>.henji-video` with every media
 * file it references frozen under `legacy/media/<name>/`. Each run opens a copy whose media paths point at the frozen
 * files, so other scenes regenerating their own caches cannot change the outcome.
 * `monitor`: plain references, must present frame 0. `closure`: also holds a fixed asset-library reference whose
 * identity (path, size, times, inode) cannot survive freezing, so the app must refuse that image as changed; the
 * project itself must still load and stay byte-identical.
 */
const LEGACY = [{ name: 'monitor', fixedReference: false }, { name: 'closure', fixedReference: true }]
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const rate = (text) => { const [num, den] = String(text).split('/').map(Number); return { num, den } }

function ffprobe(file) {
  const data = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { windowsHide: true, encoding: 'utf8' }))
  return { format: data.format, streams: data.streams, video: data.streams.find((stream) => stream.codec_type === 'video' && !stream.disposition?.attached_pic), audio: data.streams.find((stream) => stream.codec_type === 'audio') }
}

/** The media fields the import must record for a file only native decodes, derived independently from ffprobe. */
function expectedNativeFields(reference) {
  const ends = reference.streams.filter((stream) => (stream.codec_type === 'video' && !stream.disposition?.attached_pic) || stream.codec_type === 'audio')
    .filter((stream) => stream.duration !== undefined).map((stream) => Number(stream.duration) + Math.max(0, Number(stream.start_time ?? 0)))
  const average = rate(reference.video.avg_frame_rate); const real = rate(reference.video.r_frame_rate)
  return {
    kind: 'video', width: reference.video.width, height: reference.video.height, hasAudio: Boolean(reference.audio),
    durationSeconds: Math.max(...ends), frameRate: { numerator: average.num, denominator: average.den },
    frameRateMode: Math.abs(average.num / average.den / (real.num / real.den) - 1) < 0.001 ? 'sampled-constant' : 'variable',
    // Every sound stream in file order (task 2.6).
    ...(reference.audio ? { audioStreams: reference.streams.filter((stream) => stream.codec_type === 'audio').map((stream) => ({ channels: stream.channels, sampleRate: Number(stream.sample_rate) })) } : {}),
  }
}
/** The media keys an import records: the fixed set, plus the sound stream list when the file has sound (task 2.6). */
const mediaKeys = (media) => ['durationSeconds', 'frameRate', 'frameRateMode', 'hasAudio', 'height', 'id', 'kind', 'name', 'path', 'width', ...(media.hasAudio ? ['audioStreams'] : [])].sort()

/**
 * Opens an imported item in the source monitor and checks the native path end to end: no media element, a picture
 * confirmed by the render session, seeks landing on the real frame showing at the requested time, and playback
 * advancing pictures. Returns the measured numbers for the evidence file.
 */
async function nativeSourceMonitor(page, itemId, fps, durationSeconds, hasAudio) {
  const entry = page.locator(`[data-video-edit-project-entry="${itemId}"]`)
  const openedAt = Date.now(); await entry.dblclick()
  await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready' && document.querySelector('[data-video-edit-source-canvas]')?.dataset.presentedTimeUs !== undefined, null, { timeout: 30000 })
  const openMs = Date.now() - openedAt
  assert.equal(await page.locator('[data-video-edit-source-host] video').count(), 0, '只有原生能解的素材不能交给媒体元素')
  const seeks = []
  for (const seconds of [0.5, Math.min(durationSeconds - 0.2, 2.25), 0.1]) {
    const field = page.getByLabel('源素材定位秒', { exact: true })
    const at = Date.now(); await field.fill(String(seconds)); await field.press('Enter')
    await page.waitForFunction(time => {
      const canvas = document.querySelector('[data-video-edit-source-canvas]')
      const presented = Number(canvas?.dataset.presentedTimeUs) / 1e6
      // A seek may land on a picture starting up to the container timestamp tolerance after the time (task 3.2, D3).
      return document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready' && presented <= time.at + time.tolerance + 1e-6 && presented > time.at - 0.5
    }, { at: seconds, tolerance: PICTURE_TOLERANCE_SECONDS }, { timeout: 30000 })
    const presentedTimeUs = Number(await page.locator('[data-video-edit-source-canvas]').getAttribute('data-presented-time-us'))
    assert.ok(presentedTimeUs / 1e6 <= seconds + PICTURE_TOLERANCE_SECONDS + 1e-6 && presentedTimeUs / 1e6 > seconds - 1.5 / fps, `源定位 ${seconds}s 落在 ${presentedTimeUs}µs，不是该时间所在的帧`)
    seeks.push({ seconds, presentedTimeUs, ms: Date.now() - at })
  }
  const canvas = page.locator('[data-video-edit-source-canvas]')
  await canvas.evaluate((element) => {
    window.__nativeSourceFrames = []
    window.__nativeSourceObserver = new MutationObserver(() => window.__nativeSourceFrames.push({ at: performance.now(), time: Number(element.dataset.presentedTimeUs) }))
    window.__nativeSourceObserver.observe(element, { attributes: true, attributeFilter: ['data-presented-time-us'] })
  })
  await page.getByRole('button', { name: '播放源素材', exact: true }).click()
  // Source sound (2.3): the level meter reads the sound actually played (muted automation still measures the graph).
  let maxPeak = 0
  for (let tick = 0; tick < 12; tick++) {
    await page.waitForTimeout(100)
    if (!hasAudio) continue
    const peaks = await page.getByLabel('源播放电平', { exact: true }).locator('[data-video-edit-level-channel]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.peak)))
    maxPeak = Math.max(maxPeak, ...peaks)
  }
  const samples = await page.evaluate(() => { window.__nativeSourceObserver.disconnect(); return window.__nativeSourceFrames })
  if (hasAudio) assert.ok(maxPeak > 0.01, `只有原生能解的素材在源监视器中应出声，电平峰值 ${maxPeak}`)
  assert.ok(samples.length >= 10, `源监视器正向播放画面没有持续前进：${samples.length} 次更新`)
  const backwards = samples.findIndex((sample, index) => index > 0 && sample.time <= samples[index - 1].time)
  assert.equal(backwards, -1, `源监视器正向播放画面倒退：${JSON.stringify(samples.slice(Math.max(0, backwards - 3), backwards + 3).map((sample) => sample.time))}`)
  const span = (samples.at(-1).at - samples[0].at) / 1000
  await page.getByRole('button', { name: '关闭源素材', exact: true }).click()
  return { openMs, seeks, playback: { updates: samples.length, updatesPerSecond: (samples.length - 1) / span, advancedUs: samples.at(-1).time - samples[0].time, clockRate: (samples.at(-1).time - samples[0].time) / 1e6 / span, firstGapMs: samples.length > 1 ? samples[1].at - samples[0].at : null }, ...(hasAudio ? { soundPeak: maxPeak } : {}) }
}

/** Renderer logs reach the main-process store asynchronously; poll until the expected event arrives. */
async function logEvents(page, afterTimestamp, names, expected = names[0]) {
  let events = []
  for (let attempt = 0; attempt < 50; attempt++) {
    events = await queryEvents(page, afterTimestamp, names)
    if (events.some((event) => event.event === expected)) return events
    await page.waitForTimeout(100)
  }
  return events
}
async function queryEvents(page, afterTimestamp, names) {
  return page.evaluate(async ({ afterTimestamp, names }) => {
    const result = await window.henjiNative.logging.queryLogEvents({ date: afterTimestamp.slice(0, 10), afterTimestamp, limit: 500 })
    return result.events.filter((event) => names.includes(event.event)).map((event) => ({ event: event.event, level: event.level, context: event.context, error: event.error?.message ?? event.error }))
  }, { afterTimestamp, names })
}

function createVideoEditMediaProbeScene() {
  return {
    id: 'video-edit-media-probe', surface: '剪辑', name: '剪辑-原生优先素材探测与专业格式导入提示', writesUserData: true,
    setup: async (page, app) => {
      fs.mkdirSync(ROOT, { recursive: true })
      const forced = ['native', 'browser'].includes(String(process.env.HENJI_VIDEO_DECODER).toLowerCase()) ? String(process.env.HENJI_VIDEO_DECODER).toLowerCase() : null
      const evidence = { forced, probes: [], imports: [], sourceMonitor: [], legacy: [] }
      const evidencePath = path.join(ROOT, `evidence-${forced ?? 'auto'}.json`)
      const store = () => fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2))
      const samples = PROFESSIONAL.filter((sample) => fs.existsSync(sample.file) || (!sample.optional && assert.fail(`缺少样本 ${sample.file}（先运行 1.1 的样本生成）`)))
      assert.ok(fs.existsSync(CONTROL), `缺少对照样本 ${CONTROL}`)
      try {
        evidence.status = await page.evaluate(() => window.henjiNative.videoDecoder.status())
        assert.equal(evidence.status.forcedBackend, forced, '诊断变量未经平台层传到渲染层')
        assert.equal(evidence.status.available, true, '本机原生解码服务应可用')

        // 1. 平台层原生探测与同版本 ffprobe 对照。
        for (const sample of [...samples, { file: CONTROL }]) {
          await page.evaluate((dir) => window.henjiNative.media.allowRoot(dir), path.dirname(sample.file))
          const outcome = await page.evaluate((file) => window.henjiNative.videoDecoder.probe(`reality-${Date.now()}`, file), sample.file)
          assert.equal(outcome.status, 'probed', `${sample.file} 原生探测失败：${JSON.stringify(outcome)}`)
          const reference = ffprobe(sample.file)
          const probe = outcome.probe
          const video = probe.streams.find((stream) => stream.index === probe.primaryVideoStreamIndex)
          const audio = probe.streams.find((stream) => stream.index === probe.primaryAudioStreamIndex)
          const compared = {
            codec: [video.codec, reference.video.codec_name], profile: [video.profile, reference.video.profile ?? null],
            width: [video.video.width, reference.video.width], height: [video.video.height, reference.video.height],
            avgFrameRate: [video.video.avgFrameRate, rate(reference.video.avg_frame_rate)],
            containerStart: [probe.container.startTimeSeconds, Number(reference.format.start_time)],
            containerDuration: [Math.round(probe.container.durationSeconds * 1e6), Math.round(Number(reference.format.duration) * 1e6)],
            audioCodec: [audio?.codec ?? null, reference.audio?.codec_name ?? null],
          }
          for (const [field, [actual, expected]] of Object.entries(compared)) assert.deepEqual(actual, expected, `${path.basename(sample.file)} ${field} 与同版本 ffprobe 不一致`)
          assert.equal(video.decodable, true, `${path.basename(sample.file)} 原生应带解码器`)
          evidence.probes.push({ file: sample.file, container: probe.container, video: { codec: video.codec, profile: video.profile, startTimeSeconds: video.startTimeSeconds, durationSeconds: video.durationSeconds, ...video.video }, audio: audio ? { codec: audio.codec, ...audio.audio } : null, ffprobeFieldsMatched: Object.keys(compared).length })
        }
        store()

        // 2. 真实导入入口。
        await button(page, '剪辑').first().click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        const projectPath = path.join(ROOT, `import-${forced ?? 'auto'}.henji-video`); fs.rmSync(projectPath, { force: true })
        await dialogs(app, [CONTROL], projectPath); await button(page, '新建项目').click(); await adoptNewVideoEditProject(page, projectPath)
        const snapshot = () => fs.existsSync(projectPath) ? JSON.stringify(readVideoEditFile(projectPath)) : null
        const project = () => JSON.parse(snapshot() ?? '{"media":[]}')
        for (let index = 0; index < 100 && !fs.existsSync(projectPath); index++) await page.waitForTimeout(50)
        for (const sample of samples) {
          const before = snapshot()
          const startedAt = new Date().toISOString()
          await dialogs(app, [sample.file], projectPath); await button(page, '导入').click()
          if (forced === 'browser') {
            // The log carries this import's own message; the banner may still show the previous one until replaced.
            const events = await logEvents(page, startedAt, ['video_edit.media.inspect.undecodable'])
            const event = events.find((item) => item.event === 'video_edit.media.inspect.undecodable')
            assert.ok(event, `${path.basename(sample.file)} 缺少无法解码日志`)
            const message = String(event.error)
            assert.match(message, /^(当前设备无法解码此视频|当前无法读取此)/, `${path.basename(sample.file)} 提示不符`)
            await page.locator('body').getByText(message, { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
            assert.doesNotMatch(message, /原生|浏览器|native|browser|mediabunny|webcodecs|ffmpeg/i, '提示不能出现实现名称')
            await page.waitForTimeout(300)
            assert.equal(snapshot(), before, `${path.basename(sample.file)} 被拒绝后工程不能改变`)
            assert.equal(event.context.native, 'unavailable')
            evidence.imports.push({ file: sample.file, accepted: false, message, log: event.context })
            store()
            continue
          }
          // Native playback is wired (2.2): files only native decodes import with native metadata.
          for (let index = 0; index < 200 && !project().media.some((media) => path.resolve(media.path) === path.resolve(sample.file)); index++) await page.waitForTimeout(50)
          const media = project().media.find((item) => path.resolve(item.path) === path.resolve(sample.file))
          assert.ok(media, `${path.basename(sample.file)}（${sample.label}）应能导入`)
          assert.deepEqual(Object.keys(media).sort(), mediaKeys(media), '素材字段只能是固定字段与声音流清单')
          const expected = expectedNativeFields(ffprobe(sample.file))
          assert.ok(Math.abs(media.durationSeconds - expected.durationSeconds) < 1e-6, `${path.basename(sample.file)} 时长 ${media.durationSeconds} 与 ffprobe 绝对结束时间 ${expected.durationSeconds} 不一致`)
          const { id: _id, name: _name, path: _path, durationSeconds: _duration, ...fields } = media
          const { durationSeconds: _expectedDuration, ...expectedFields } = expected
          assert.deepEqual(fields, expectedFields, `${path.basename(sample.file)} 元数据与 ffprobe 不一致`)
          const completed = (await logEvents(page, startedAt, ['video_edit.media.inspect.completed'])).find((item) => item.event === 'video_edit.media.inspect.completed')
          assert.ok(completed, `${path.basename(sample.file)} 缺少探测完成日志`)
          assert.deepEqual({ backend: completed.context.backend, native: completed.context.native, nativeDecodes: completed.context.nativeDecodes, browserDecodes: completed.context.browserDecodes }, { backend: 'native', native: 'probed', nativeDecodes: true, browserDecodes: false })
          evidence.imports.push({ file: sample.file, label: sample.label, accepted: true, media, expected, log: completed.context })
          store()
        }
        if (forced !== 'browser') for (const record of evidence.imports.filter((item) => item.accepted)) {
          const item = project().items.find((candidate) => candidate.mediaId === record.media.id)
          assert.ok(item, `${path.basename(record.file)} 缺少素材项`)
          const fps = record.media.frameRate.numerator / record.media.frameRate.denominator
          evidence.sourceMonitor.push({ file: record.file, ...await nativeSourceMonitor(page, item.id, fps, record.media.durationSeconds, record.media.hasAudio === true) })
          store()
        }
        const startedAt = new Date().toISOString()
        await dialogs(app, [CONTROL], projectPath); await button(page, '导入').click()
        for (let index = 0; index < 200 && !project().media.some((media) => media.path === CONTROL); index++) await page.waitForTimeout(50)
        const media = project().media.find((item) => item.path === CONTROL)
        assert.ok(media, 'H.264+AAC 对照样本应能导入')
        assert.deepEqual(Object.keys(media).sort(), mediaKeys(media), '素材字段只能是固定字段与声音流清单')
        assert.equal(media.audioStreams?.length, 1, 'H.264+AAC 对照样本只有一条声音流')
        assert.deepEqual({ kind: media.kind, width: media.width, height: media.height, hasAudio: media.hasAudio, frameRate: media.frameRate, frameRateMode: media.frameRateMode }, { kind: 'video', width: 3840, height: 2160, hasAudio: true, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' })
        const completed = (await logEvents(page, startedAt, ['video_edit.media.inspect.completed']))[0]
        assert.ok(completed, '缺少探测完成日志')
        // Native is the primary path since native sound decoding (2.3 stage B): the control sample plays natively unless
        // the diagnostic setting forces the browser.
        assert.equal(completed.context.backend, forced === 'browser' ? 'browser' : 'native', '对照样本的实际播放后端不符')
        assert.equal(completed.context.nativeDecodes, forced !== 'browser', '日志单独记录原生能否解码')
        assert.equal(completed.context.native, forced === 'browser' ? 'unavailable' : 'probed')
        assert.equal(completed.context.browserDecodes, true)
        evidence.imports.push({ file: CONTROL, accepted: true, media, log: completed.context })
        store()

        // 3. 2.1 改动前由应用保存的旧工程：打开不迁移。
        for (const legacy of LEGACY) {
          const source = path.join(ROOT, 'legacy', `${legacy.name}.henji-video`); const mediaDir = path.join(ROOT, 'legacy', 'media', legacy.name)
          assert.ok(fs.existsSync(source) && fs.existsSync(mediaDir), `缺少旧工程快照 ${source}（本机证据，见 2.1 执行记录）`)
          const document = readVideoEditFile(source)
          for (const media of document.media) {
            const frozen = path.join(mediaDir, path.basename(media.path))
            assert.ok(fs.existsSync(frozen), `旧工程快照缺少素材 ${frozen}`)
            media.path = frozen
          }
          const target = path.join(ROOT, `legacy-open-${forced ?? 'auto'}-${legacy.name}.henji-video`); fs.writeFileSync(target, JSON.stringify(document))
          const hash = sha256(target)
          if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
          await dialogs(app, [target], target); await openVideoEditFile(page, target)
          let outcome = 'presented'
          if (legacy.fixedReference) {
            const refused = page.locator('body').getByText(/源文件已改变或丢失/).first()
            outcome = await Promise.race([presented(page, 0).then(() => 'presented'), refused.waitFor({ state: 'visible', timeout: 90000 }).then(() => 'fixed_reference_refused')])
          } else await presented(page, 0)
          await page.waitForTimeout(1500)
          assert.equal(sha256(target), hash, `${legacy.name} 打开后被改写（迁移）`)
          evidence.legacy.push({ file: source, savedAt: fs.statSync(source).mtime.toISOString(), media: document.media.length, outcome, unchanged: true })
          store()
        }
        evidence.completed = true
        store()
        console.log(`[video-edit-media-probe] ${JSON.stringify({ forced, probes: evidence.probes.length, imported: evidence.imports.filter((item) => item.accepted).length, refused: evidence.imports.filter((item) => !item.accepted).length, sourceMonitor: evidence.sourceMonitor.map((item) => ({ file: path.basename(item.file), openMs: item.openMs, updatesPerSecond: Math.round(item.playback.updatesPerSecond) })), legacy: evidence.legacy.map((item) => item.outcome) })}`)
      } catch (error) {
        evidence.failed = String(error?.message ?? error)
        store()
        throw error
      }
    },
  }
}

module.exports = { createVideoEditMediaProbeScene }
