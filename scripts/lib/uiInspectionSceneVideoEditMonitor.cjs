const assert = require('node:assert/strict')
const { VIDEO_EDIT_TRACK_HEADER_WIDTH } = require('./uiInspectionVideoEditGeometry.cjs')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const sharp = require('sharp')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { observeNativeWaveforms, nativeWaveformSnapshot, waitNativeWaveformsReleased, restoreNativeWaveformObservers } = require('./uiInspectionSceneVideoEditMonitorResources.cjs')
const { chooseVideoEditImportFiles, openVideoEditFile, readVideoEditFile, closeVideoEditDockPanel } = require('./uiInspectionVideoEditDocuments.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
const panel = (page, id) => page.locator(`[data-video-edit-panel="${id}"]`).first()
const quantile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0
// 3.1：剪辑是项目里的文档文件，按旧工程形状读出（夹具路径读它对应的实际剪辑）
const readProject = readVideoEditFile
async function trackBanks(page) {
  const rows = await page.locator('[data-video-edit-track]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.videoEditTrack, index: Number(node.dataset.trackIndex), kind: node.dataset.trackKind, top: node.getBoundingClientRect().top })))
  const video = rows.filter(row => row.kind === 'video'); const audio = rows.filter(row => row.kind === 'audio')
  assert.deepEqual(video.map(row => row.index), video.map(row => row.index).sort((a, b) => b - a), '画面上层轨道须位于时间线上方')
  assert.deepEqual(audio.map(row => row.index), audio.map(row => row.index).sort((a, b) => a - b))
  if (video.length && audio.length) assert.ok(Math.max(...video.map(row => row.top)) < Math.min(...audio.map(row => row.top)), '全部声音轨道须位于全部画面轨道下方')
  return rows
}
async function dialogs(app, openPaths, savePath) {
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: values.openPaths })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.savePath })
  }, { openPaths, savePath })
}
async function saved(page, file, matches) {
  let current
  for (let attempt = 0; attempt < 200; attempt++) {
    current = readProject(file)
    if (matches(current)) return current
    await page.waitForTimeout(50)
  }
  assert.fail(`工程未静默保存预期监视器内容：${JSON.stringify(current)}`)
}
async function presented(page, frame) {
  await page.waitForFunction(frame => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    return canvas?.dataset.presentedFrame === String(frame) && canvas.dataset.scrubbing !== 'true'
  }, frame, { timeout: 90000 })
}
async function sourceReady(page, kind) {
  await page.waitForFunction(kind => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready'
    && document.querySelector(`[data-video-edit-source-media="${kind}"]`), kind, { timeout: 30000 })
}
async function poll(page, read, matches, message, attempts = 200) {
  let value
  for (let attempt = 0; attempt < attempts; attempt++) {
    value = await read()
    if (matches(value)) return value
    await page.waitForTimeout(50)
  }
  assert.fail(`${message}：${JSON.stringify(value)}`)
}
/**
 * 2.4 交接（3.5 修正，不放宽）：同一进程连续运行时，前序场景可能已把同一素材的多级波形写入同一临时资料的磁盘缓存，
 * 本场景就不再解码。“解码”与“命中缓存”两条路都必须得到真实采样率、真实帧数且画出墨迹的波形；
 * 命中缓存时该素材确实没有起解码进程，解码时仍按原判据核对解码进程与 Worker 峰值。
 */
async function clipWaveform(page, clipId) {
  return page.locator(`[data-video-edit-waveform="${clipId}"] canvas`).first().evaluate(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
    let inked = 0
    for (let index = 3; index < data.length; index += 4) if (data[index] > 0) inked++
    return { state: canvas.dataset.waveformState, sampleRate: Number(canvas.dataset.waveformSampleRate), frames: Number(canvas.dataset.waveformFrames), inked, total: data.length / 4 }
  }).catch(() => null)
}
async function levels(page, title) {
  return page.getByLabel(title, { exact: true }).locator('[data-video-edit-level-channel]').evaluateAll(nodes => nodes.map(node => ({ peak: Number(node.dataset.peak), rms: Number(node.dataset.rms) })))
}
async function waitLevel(page, title, audible) {
  await page.waitForFunction(({ title, audible }) => {
    const meter = document.querySelector(`[aria-label="${title}"]`)
    if (!meter) return false
    const channels = [...meter.querySelectorAll('[data-video-edit-level-channel]')]
    return channels.length > 0 && (audible ? channels.some(node => Number(node.dataset.peak) > .01 && Number(node.dataset.rms) > .003)
      : channels.every(node => Number(node.dataset.peak) < .00001 && Number(node.dataset.rms) < .00001))
  }, { title, audible }, { timeout: 15000 })
  return levels(page, title)
}
async function png(page, file) {
  const image = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ base64: canvas.toDataURL('image/png').split(',')[1], width: canvas.width, height: canvas.height, data: { ...canvas.dataset } }))
  assert.equal(image.width, 3840); assert.equal(image.height, 2160)
  fs.writeFileSync(file, Buffer.from(image.base64, 'base64'))
  return { file, width: image.width, height: image.height, data: image.data }
}
async function pixelDifference(a, b, region) {
  const raw = file => (region ? sharp(file).extract(region) : sharp(file)).removeAlpha().raw().toBuffer()
  const [left, right] = await Promise.all([raw(a), raw(b)])
  assert.equal(left.length, right.length)
  let changed = 0; let square = 0; let maximum = 0
  for (let index = 0; index < left.length; index++) {
    const delta = Math.abs(left[index] - right[index]); if (delta) changed++
    square += delta * delta; maximum = Math.max(maximum, delta)
  }
  return { changedChannels: changed, maximumDelta: maximum, rms: Math.sqrt(square / left.length), psnr: square ? 10 * Math.log10(255 ** 2 / (square / left.length)) : null, equal: changed === 0 }
}
function mediaProbe(ffprobePath, file) {
  return JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { encoding: 'utf8', windowsHide: true }))
}
function generatedControls(root, ffmpegPath, ffprobePath) {
  const stereo = path.join(root, '44100-stereo.wav'); const audiovisual = path.join(root, '4k60-aac-control.mp4')
  const run = args => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, stdio: 'pipe', timeout: 120000 })
  // Synthetic controls only. Existing project media and the user's original video are never transformed.
  if (!fs.existsSync(stereo)) run(['-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*660*t)|0.1*sin(2*PI*990*t):s=44100:d=3', '-c:a', 'pcm_s16le', stereo])
  if (!fs.existsSync(audiovisual)) run(['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60:duration=3', '-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*330*t)|0.15*sin(2*PI*550*t):s=48000:d=3', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-g', '60', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', audiovisual])
  const stereoProbe = mediaProbe(ffprobePath, stereo); const avProbe = mediaProbe(ffprobePath, audiovisual)
  const wave = stereoProbe.streams.find(stream => stream.codec_type === 'audio'); const audio = avProbe.streams.find(stream => stream.codec_type === 'audio'); const video = avProbe.streams.find(stream => stream.codec_type === 'video')
  assert.equal(Number(wave.sample_rate), 44100); assert.equal(wave.channels, 2)
  assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(video.avg_frame_rate, '60/1'); assert.equal(Number(video.nb_frames), 180)
  assert.equal(audio.codec_name, 'aac'); assert.equal(Number(audio.sample_rate), 48000); assert.equal(audio.channels, 2)
  return { stereo, audiovisual, stereoProbe, avProbe }
}

/** Formal launcher, actual native media, public MCP writes, and presented-frame observations only. */
function createVideoEditMonitorScene() {
  return { id: 'video-edit-monitor', surface: '剪辑', name: '剪辑-源范围音画、波形电平与字幕4K60回环', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-monitor'); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'monitor.henji-video'); const pressureFile = path.join(root, 'pressure.henji-video')
      const evidence = { completed: false, phases: [], captures: [], exports: [], originalPaths: [] }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const shot = async name => { const result = await capture(name); evidence.captures.push({ name, ...(result ? { result } : {}) }); store() }
      let client; let nativeObserved = false; let renderObserved = false; let previousLayout
      try {
        const { ffmpegPath, ffprobePath } = require('./mediaBinaries.cjs')
        evidence.currentPhase = '生成并探测独立音视频控制样本'; store()
        const controls = generatedControls(root, ffmpegPath, ffprobePath); evidence.controls = controls
        const project = readProject(path.resolve('node_modules/.cache/video-edit-code-controls/code-project.henji-video'))
        const pressure = readProject(path.resolve('node_modules/.cache/video-edit-scrub-original/scrub.henji-video'))
        const originalPaths = [...new Set([...project.media, ...pressure.media].map(media => media.path))]
        evidence.originalPaths = originalPaths.map(file => ({ file, size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs }))
        const pressureProbe = mediaProbe(ffprobePath, pressure.media.find(media => media.kind === 'video').path)
        assert.ok(!pressureProbe.streams.some(stream => stream.codec_type === 'audio'), '原 intro4K60 已确认无音轨，不能伪造 hasAudio')
        const pressureVideo = pressureProbe.streams.find(stream => stream.codec_type === 'video')
        assert.equal(pressureVideo.width, 3840); assert.equal(pressureVideo.height, 2160); assert.equal(pressureVideo.avg_frame_rate, '60/1')
        evidence.originalVideoProbe = pressureProbe
        project.id = 'monitor-mixed'; project.name = '源范围与字幕真实混剪'; project.revision = 0; project.sequences = [project.sequences[0]]
        const sequence = project.sequences[0]; sequence.id = 'monitor-sequence'; sequence.name = '4K60 音画与字幕'; sequence.annotations = []; sequence.captions = []; sequence.markers = []
        sequence.sampleRate = 48000; sequence.channels = 2
        sequence.tracks = Array.from({ length: 8 }, (_, index) => ({ id: `monitor-track-${index}`, index, name: index === 0 ? '单声道声音' : index === 1 ? '立体声声音' : index === 7 ? '源声音目标' : index === 6 ? '源画面目标' : `画面 ${index}`, kind: [0, 1, 7].includes(index) ? 'audio' : 'video', locked: false, enabled: true, muted: false, solo: false, height: 32, syncLocked: true }))
        sequence.clips.forEach(clip => { if (clip.track > 0) clip.track++ })
        const baseVideo = sequence.clips.find(clip => clip.kind === 'video'); const baseAudio = sequence.clips.find(clip => clip.kind === 'audio')
        const basePaths = project.media.map(media => media.path); const codeSources = project.codeMaterials.map(material => material.versions)
        assert.equal(sequence.width, 3840); assert.equal(sequence.height, 2160); assert.deepEqual(sequence.frameRate, { numerator: 60, denominator: 1 })
        for (const media of project.media.filter(media => media.kind === 'video')) media.hasAudio = mediaProbe(ffprobePath, media.path).streams.some(stream => stream.codec_type === 'audio')
        fs.writeFileSync(file, JSON.stringify(project))
        pressure.id = 'monitor-pressure'; pressure.name = '监视器32轨500片段原素材4K60'; pressure.revision = 0
        pressure.sequences = [pressure.sequences[0]]; const pressureSequence = pressure.sequences[0]; pressureSequence.id = 'monitor-pressure-sequence'
        pressure.media.forEach(media => { if (media.kind === 'video') { media.hasAudio = false; media.frameRate = { numerator: 60, denominator: 1 } } })
        pressureSequence.tracks = Array.from({ length: 32 }, (_, index) => ({ id: `monitor-pressure-track-${index}`, name: index ? `视频 ${index}` : '音频 1', index, kind: index ? 'video' : 'audio', locked: false, enabled: true, muted: false, solo: false, height: 32, syncLocked: true }))
        assert.equal(pressureSequence.clips.length, 3)
        pressureSequence.clips.push(...Array.from({ length: 497 }, (_, index) => ({ ...pressureSequence.clips[0], id: `monitor-offscreen-${index}`, start: 3600 + index * 4, duration: 2, track: 31 })))
        pressureSequence.captions = Array.from({ length: 500 }, (_, index) => ({ id: `monitor-caption-${index}`, start: 7200 + index * 2, duration: 1, text: `范围字幕 ${index}` }))
        fs.writeFileSync(pressureFile, JSON.stringify(pressure))
        const open = async target => { await dialogs(app, [target], target); await openVideoEditFile(page, target); await presented(page, 0) }
        await button(page, '剪辑').click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await button(page, '生成').click()
        previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        await observeWorkers(page); renderObserved = true
        await observeNativeWaveforms(app); nativeObserved = true
        await button(page, '剪辑').click(); await open(file)
        evidence.trackBanks = { mixed: await trackBanks(page) }
        const identity = await authorizeMcpConnection(page, { name: '源监视器音画与字幕回环', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Henji monitor Reality')
        const projectRef = { kind: 'video_edit.document', id: project.id }; const sequenceRef = { kind: 'video_edit.sequence', id: `${project.id}:${sequence.id}` }; const sourceRef = { kind: 'video_edit.source', id: `${project.id}:source` }
        const read = (ref, propertyIds) => callTool(client, 'read_application_entity', { ref, propertyIds })
        const change = async (ref, properties) => {
          const result = await callTool(client, 'change_application_entities', operationEnvelope([await read(ref, Object.keys(properties))], { summary: '监视器正式音画与字幕编辑', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties }] }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result)); return result
        }
        const focus = async ref => { const result = await callTool(client, 'focus_application_entity', operationEnvelope([], { ref })); assert.equal(result.executionState, 'completed', JSON.stringify(result)); return result }
        const frame = async value => { await change(projectRef, { 'video_edit.document.program_playback': { frame: value, playing: false, playbackDirection: 1 } }); await presented(page, value) }
        const play = async ref => change(ref, { 'video_edit.document.program_playback': { frame: 0, playing: true, playbackDirection: 1 } })
        const sourceRead = async () => (await read(sourceRef, ['video_edit.source.time_us', 'video_edit.source.presented_time_us', 'video_edit.source.in_us', 'video_edit.source.out_us', 'video_edit.source.playing', 'video_edit.source.status'])).data.properties
        const openSource = async item => {
          await focus({ kind: 'video_edit.item', id: `${project.id}:${item.id}` })
          await page.locator(`[data-video-edit-project-entry="${item.id}"]`).dblclick(); await sourceReady(page, item.kind)
        }
        const setRange = async () => {
          await change(sourceRef, { 'video_edit.source.time_us': 500000, 'video_edit.source.playing': false })
          await button(panel(page, 'source'), '设入点').click()
          // 74/60 seconds is fractional microseconds: seek inside that frame,
          // rather than one third of a microsecond before its actual PTS.
          await change(sourceRef, { 'video_edit.source.time_us': 1233334, 'video_edit.source.playing': false })
          await button(panel(page, 'source'), '设出点').click()
          const state = await poll(page, sourceRead, value => value['video_edit.source.in_us'] === 500000 && value['video_edit.source.out_us'] === 1250000, '源入出点应按真实画面半开边界确认')
          return state
        }
        evidence.currentPhase = '真实导入、范围波形和混音电平'; store()
        await dialogs(app, [controls.stereo, controls.audiovisual], file); await chooseVideoEditImportFiles(page)
        let document = await saved(page, file, value => value.media.some(media => media.path === controls.stereo) && value.media.some(media => media.path === controls.audiovisual))
        const stereoMedia = document.media.find(media => media.path === controls.stereo); const avMedia = document.media.find(media => media.path === controls.audiovisual)
        assert.equal(avMedia.hasAudio, true); assert.deepEqual(avMedia.frameRate, { numerator: 60, denominator: 1 }); assert.equal(avMedia.width, 3840); assert.equal(avMedia.height, 2160)
        const stereoItem = document.items.find(item => item.mediaId === stereoMedia.id); const avItem = document.items.find(item => item.mediaId === avMedia.id); const monoItem = document.items.find(item => item.id === baseAudio.itemId)
        const created = await callTool(client, 'change_application_entities', operationEnvelope([await read(sequenceRef, ['video_edit.sequence.name'])], { summary: '加入真实44.1kHz立体声原文件', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': stereoItem.id, 'video_edit.clip.name': '44.1kHz立体声', 'video_edit.clip.kind': 'audio', 'video_edit.clip.track': 1, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 180, 'video_edit.clip.volume': .5 } }] }] }))
        assert.equal(created.executionState, 'completed', JSON.stringify(created)); assert.equal(created.verificationState, 'verified', JSON.stringify(created))
        document = await saved(page, file, value => value.sequences[0].clips.some(clip => clip.itemId === stereoItem.id))
        const stereoClip = document.sequences[0].clips.find(clip => clip.itemId === stereoItem.id)
        await page.locator(`[data-video-edit-waveform="${baseAudio.id}"]`).waitFor({ state: 'visible', timeout: 30000 })
        await page.locator(`[data-video-edit-waveform="${stereoClip.id}"]`).waitFor({ state: 'visible', timeout: 30000 })
        evidence.timelineWaveforms = { clipIds: [baseAudio.id, stereoClip.id], visible: true, native: await nativeWaveformSnapshot(app) }
        const monoPath = document.media.find(media => media.id === monoItem.mediaId).path
        const inkedWave = value => value?.state === 'ready' && value.inked > value.total * .02
        const stereoWave = await poll(page, () => clipWaveform(page, stereoClip.id), inkedWave, '44.1kHz立体声片段须画出真实波形')
        const monoWave = await poll(page, () => clipWaveform(page, baseAudio.id), inkedWave, '48kHz单声道片段须画出真实波形')
        assert.equal(stereoWave.sampleRate, 44100); assert.equal(stereoWave.frames, 132300)
        assert.equal(monoWave.sampleRate, 48000); assert.ok(monoWave.frames >= 60000)
        const wholeWave = await nativeWaveformSnapshot(app)
        const decodesOf = file => wholeWave.processes.filter(process => process.source === file)
        evidence.timelineWaveforms.drawn = { stereo: stereoWave, mono: monoWave }
        evidence.timelineWaveforms.decoded = { stereo: decodesOf(controls.stereo).length > 0, mono: decodesOf(monoPath).length > 0 }
        if (evidence.timelineWaveforms.decoded.stereo) {
          await poll(page, () => nativeWaveformSnapshot(app), value => value.workers.some(worker => worker.options?.expectedFrames === 132300 && worker.channels?.every(channel => channel.sampleCount === 132300 && channel.maxPeak > .05 && channel.maxRms > .02)), '正式范围解码须保持真实44.1kHz且产生非零峰值与RMS')
          assert.ok(decodesOf(controls.stereo).some(process => process.sampleRate === 44100 && process.channels === 2 && process.firstSample === 0 && process.sampleCount === 132300))
        }
        if (evidence.timelineWaveforms.decoded.mono) assert.ok(decodesOf(monoPath).every(process => process.sampleRate === 48000), '单声道素材解码须保持真实48kHz')
        evidence.timelineWaveforms.native = wholeWave; await shot('monitor-timeline-range-waveforms')
        await play(projectRef); evidence.meters = { mix: await waitLevel(page, '节目播放电平', true) }; await frame(0)
        await button(page, '单声道声音静音').click(); await button(page, '立体声声音静音').click()
        await saved(page, file, value => value.sequences[0].tracks.slice(0, 2).every(track => track.muted))
        await play(projectRef); await page.waitForFunction(() => Number(document.querySelector('canvas[aria-label="剪辑画面"]').dataset.presentedFrame) >= 10)
        evidence.meters.muted = await waitLevel(page, '节目播放电平', false); await frame(0)
        await button(page, '单声道声音静音').click(); await button(page, '立体声声音静音').click(); await button(page, '单声道声音独奏').click()
        await saved(page, file, value => value.sequences[0].tracks[0].solo && !value.sequences[0].tracks[0].muted && !value.sequences[0].tracks[1].muted)
        await play(projectRef); evidence.meters.solo = await waitLevel(page, '节目播放电平', true)
        assert.equal(evidence.meters.solo.length, 2); assert.ok(Math.abs(evidence.meters.solo[0].rms - evidence.meters.solo[1].rms) < .01, '单声道独奏应等量映射到节目左右声道')
        await shot('monitor-actual-mix-meter'); await frame(0); await button(page, '单声道声音独奏').click()
        await saved(page, file, value => !value.sequences[0].tracks[0].solo)
        // 2.3: one whole-file multi-level pyramid per sound stream (absolute clock from 0); the source range
        // 0.5..1.25 s is sliced from it. The mono base clip's pyramid was decoded for the timeline in this run,
        // so opening the source must reuse it (no second decode) and still draw the exact range.
        const monoDecodes = value => value.processes.filter(process => process.source === monoPath)
        const pyramidDecoded = value => monoDecodes(value).some(process => process.firstSample === 0 && process.sampleRate === 48000 && process.sampleCount >= 60000 && process.ended && process.exitCode === 0
          && value.workers.some(worker => worker.options?.kind === 'pyramid' && worker.options.expectedFrames === process.sampleCount && worker.channels?.some(channel => channel.sampleCount === process.sampleCount && channel.maxPeak > .01 && channel.maxRms > .003)))
        // 本次运行解码过就核对解码本身；命中前序场景的磁盘缓存时，上面已核对时间线波形为真实48kHz整段且有墨迹。
        const beforeSource = evidence.timelineWaveforms.decoded.mono ? await poll(page, () => nativeWaveformSnapshot(app), pyramidDecoded, '时间线须已按整文件多级波形解码单声道素材（绝对时钟0起、覆盖0.5..1.25秒）') : await nativeWaveformSnapshot(app)
        await openSource(monoItem)
        await change(sourceRef, { 'video_edit.source.in_us': 500000, 'video_edit.source.out_us': 1250000, 'video_edit.source.time_us': 500000, 'video_edit.source.playing': false })
        const sourceWave = page.locator('[data-video-edit-source-waveform]')
        await sourceWave.waitFor({ state: 'visible', timeout: 30000 })
        await sourceWave.locator('canvas[data-waveform-state="ready"]').waitFor({ state: 'visible', timeout: 30000 })
        assert.equal(Number(await sourceWave.locator('canvas').first().getAttribute('data-waveform-sample-rate')), 48000, '源波形须来自真实48kHz多级波形')
        assert.equal((await sourceWave.locator('span').first().textContent()).trim(), '00:00:00.500000 — 00:00:01.250000', '源波形应只显示入出点半开范围')
        const rangeWave = await nativeWaveformSnapshot(app)
        assert.equal(monoDecodes(rangeWave).length, monoDecodes(beforeSource).length, '打开源素材应命中本次已生成的多级波形，不得再起解码')
        const sourceInk = await sourceWave.locator('canvas').evaluate(canvas => {
          const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
          let inked = 0
          for (let index = 3; index < data.length; index += 4) if (data[index] > 0) inked++
          return { inked, total: data.length / 4, width: canvas.width, height: canvas.height }
        })
        assert.ok(sourceInk.inked > sourceInk.total * .02, `源波形画布须画出非静音范围：${JSON.stringify(sourceInk)}`)
        evidence.sourceRangeWaveform = { ...rangeWave, monoDecodes: monoDecodes(rangeWave), sourceInk }
        await play(projectRef); await waitLevel(page, '节目播放电平', true)
        await button(panel(page, 'source'), '正向').click(); await waitLevel(page, '源播放电平', true); await waitLevel(page, '节目播放电平', false)
        const stoppedProgram = (await read(projectRef, ['video_edit.document.program_playback'])).data.properties['video_edit.document.program_playback']; assert.equal(stoppedProgram.playing, false)
        // Native is the primary path (2.3): local items play through the native source views (no media element);
        // the diagnostic setting forcing the browser keeps the media elements.
        const sourceNative = String(process.env.HENJI_VIDEO_DECODER ?? '').toLowerCase() !== 'browser'
        if (sourceNative) {
          assert.equal(await panel(page, 'source').locator('audio').count(), 0, '原生后端的声音素材不用媒体元素')
          assert.equal(await panel(page, 'source').locator('[data-video-edit-source-sound]').count(), 1, '原生声音视图只有一个')
        } else assert.equal(await panel(page, 'source').locator('audio').count(), 1, '复用AudioPlayer不能另建音频元素')
        await play(projectRef)
        if (sourceNative) await poll(page, sourceRead, value => value['video_edit.source.playing'] === false, '节目播放应暂停源声音')
        else await page.waitForFunction(() => document.querySelector('[data-video-edit-source-media="audio"]').paused)
        assert.equal((await sourceRead())['video_edit.source.playing'], false)
        evidence.mutualExclusion = { audio: { sourcePausedProgram: true, programPausedSource: true, audioElements: sourceNative ? 0 : 1, native: sourceNative } }; await frame(0)
        await button(page, '关闭源素材').click(); await openSource(avItem)
        await change(sourceRef, { 'video_edit.source.time_us': 0, 'video_edit.source.in_us': null, 'video_edit.source.out_us': null, 'video_edit.source.playing': false })
        if (sourceNative) await page.locator('[data-video-edit-source-canvas]').evaluate(canvas => {
          // The native source view confirms every presented picture on its canvas.
          window.__monitorSourceFrames = []; window.__monitorSourceFramesStop = false
          window.__monitorSourceObserver = new MutationObserver(() => { if (!window.__monitorSourceFramesStop) window.__monitorSourceFrames.push({ at: performance.now(), presentedTimeUs: Number(canvas.dataset.presentedTimeUs) }) })
          window.__monitorSourceObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-time-us'] })
        })
        else await page.locator('[data-video-edit-source-media="video"]').evaluate(video => {
          window.__monitorSourceFrames = []; window.__monitorSourceFramesStop = false
          const next = (_now, metadata) => { window.__monitorSourceFrames.push({ at: performance.now(), mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames }); if (!window.__monitorSourceFramesStop && video.isConnected) video.requestVideoFrameCallback(next) }
          video.requestVideoFrameCallback(next)
        })
        await play(projectRef); await button(panel(page, 'source'), '正向').click()
        await waitLevel(page, '源播放电平', true); await waitLevel(page, '节目播放电平', false)
        await page.waitForFunction(() => window.__monitorSourceFrames.length >= 12)
        await play(projectRef)
        if (sourceNative) await poll(page, sourceRead, value => value['video_edit.source.playing'] === false, '节目播放应暂停源画面')
        else await page.waitForFunction(() => document.querySelector('[data-video-edit-source-media="video"]').paused)
        assert.equal((await sourceRead())['video_edit.source.playing'], false)
        evidence.mutualExclusion.video = { sourcePausedProgram: true, programPausedSource: true, native: sourceNative, actualFrames: await page.evaluate(() => { window.__monitorSourceFramesStop = true; window.__monitorSourceObserver?.disconnect(); return window.__monitorSourceFrames }) }
        if (sourceNative) {
          const frames = evidence.mutualExclusion.video.actualFrames
          assert.ok(frames.every((entry, index) => index === 0 || entry.presentedTimeUs >= frames[index - 1].presentedTimeUs), '源监视器正向播放画面不能倒退')
        }
        await frame(0); evidence.sourceRange = await setRange(); await shot('monitor-source-precise-range')
        evidence.currentPhase = '源画面、声音和关联分量拖入与一次撤销'; store()
        const viewport = page.locator('[data-video-edit-timeline-viewport]'); const beforeRange = readProject(file).sequences[0].clips
        await change(projectRef, { 'video_edit.document.timeline_view': { ...(await read(projectRef, ['video_edit.document.timeline_view'])).data.properties['video_edit.document.timeline_view'], zoom: 1, targetTrackIds: ['monitor-track-7'] } })
        evidence.rangeDrops = []
        for (const component of ['video', 'audio', 'linked']) {
          const track = component === 'audio' ? 7 : 6; const name = component === 'video' ? '拖入画面' : component === 'audio' ? '拖入声音' : '拖入链接音画'
          await viewport.evaluate(host => { host.scrollLeft = 0 })
          // 轨道头只挂载视口内的轨道，不能靠 scrollIntoView；像用户一样在对应分区（画面在上、声音在下）按住 Ctrl 滚轮滚到目标轨道。
          for (let attempt = 0; ; attempt++) {
            const where = await viewport.evaluate((host, track) => { const row = host.querySelector(`[data-track-index="${track}"]`); if (!row) return 'missing'; const box = host.getBoundingClientRect(); const rect = row.getBoundingClientRect(); return rect.top < box.top + 40 ? 'up' : rect.bottom > box.bottom - 8 ? 'down' : 'ok' }, track)
            if (where === 'ok') break
            assert.ok(attempt < 60, `时间线滚不到轨道 ${track}（${where}）`)
            const box = await viewport.boundingBox()
            await page.mouse.move(box.x + box.width / 2, component === 'audio' ? box.y + box.height - 24 : box.y + 48)
            await page.keyboard.down('Control'); await page.mouse.wheel(0, where === 'down' ? 80 : -80); await page.keyboard.up('Control'); await page.waitForTimeout(30)
          }
          const offset = await viewport.evaluate((host, { track, headerWidth }) => { const row = host.querySelector(`[data-track-index="${track}"]`); return { x: headerWidth + 2 - host.scrollLeft, y: row.getBoundingClientRect().top - host.getBoundingClientRect().top + 16 } }, { track, headerWidth: VIDEO_EDIT_TRACK_HEADER_WIDTH })
          // 记录真实原生拖放链路，区分 dragTo 完成与浏览器实际派发 drop。
          // dragover 只读 types，不尝试读取保护模式下的载荷。
          await page.evaluate(() => {
            const events = []; const types = ['dragstart', 'dragover', 'drop', 'dragend']
            const entries = new WeakMap()
            const afterHandlers = event => {
              const entry = entries.get(event)
              if (!entry) return
              entry.defaultPrevented = event.defaultPrevented
              entry.types = Array.from(event.dataTransfer?.types ?? [])
              entry.dropEffect = event.dataTransfer?.dropEffect
              entry.effectAllowed = event.dataTransfer?.effectAllowed
            }
            const record = event => {
              const target = event.target instanceof Element ? event.target : null
              const host = document.querySelector('[data-video-edit-timeline-viewport]')
              const rect = host?.getBoundingClientRect()
              const entry = { type: event.type, clientX: event.clientX, clientY: event.clientY, types: Array.from(event.dataTransfer?.types ?? []), effectAllowed: event.dataTransfer?.effectAllowed, dropEffect: event.dataTransfer?.dropEffect, sourceStatus: document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus, button: target?.closest('button')?.getAttribute('aria-label'), inTimeline: Boolean(target?.closest('[data-video-edit-timeline-viewport]')), track: target?.closest('[data-track-index]')?.getAttribute('data-track-index'), viewport: rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height, scrollLeft: host.scrollLeft } : null }
              events.push(entry); entries.set(event, entry)
              // drop 会 stopPropagation，仍在整次派发结束后记录是否被接收；载荷类型保留事件内的快照。
              setTimeout(() => { entry.defaultPrevented = event.defaultPrevented }, 0)
            }
            for (const type of types) { document.addEventListener(type, record, true); document.addEventListener(type, afterHandlers) }
            window.__monitorRangeDragEvidence = { events, remove: () => { for (const type of types) { document.removeEventListener(type, record, true); document.removeEventListener(type, afterHandlers) } } }
          })
          try { await button(panel(page, 'source'), name).dragTo(viewport, { targetPosition: offset }) }
          finally {
            evidence.lastRangeDrag = { component, targetTrack: track, offset, events: await page.evaluate(() => { const trace = window.__monitorRangeDragEvidence; trace.remove(); delete window.__monitorRangeDragEvidence; return trace.events }) }
            store()
          }
          const count = component === 'linked' ? 2 : 1
          document = await saved(page, file, value => value.sequences[0].clips.length === beforeRange.length + count)
          const added = document.sequences[0].clips.filter(clip => !beforeRange.some(prior => prior.id === clip.id))
          assert.equal(added.length, count)
          for (const clip of added) { assert.equal(clip.itemId, avItem.id); assert.equal(clip.sourceInUs, 500000); assert.equal(clip.duration, 45); assert.equal(clip.start, 0); assert.deepEqual(clip.sourceRemainder, { numerator: 0, denominator: 1 }); assert.equal(document.sequences[0].tracks.find(track => track.index === clip.track).kind, clip.kind) }
          if (component === 'linked') { assert.ok(added[0].linkId); assert.equal(added[0].linkId, added[1].linkId); assert.deepEqual(added.map(clip => clip.sourceComponent).sort(), ['audio', 'video']); assert.deepEqual(added.map(clip => clip.track).sort((a, b) => a - b), [6, 7]) }
          else assert.equal(added[0].sourceComponent, component)
          await frame(20)
          const actual = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset }))
          if (component !== 'audio') assert.ok(actual.sourceTimestamps.split(',').map(Number).some(time => Math.abs(time - 50 / 60) < .00002), '拖入画面必须呈现源入点之后的对应实际PTS')
          if (component !== 'video') { await play(projectRef); await waitLevel(page, '节目播放电平', true); await frame(20) }
          evidence.rangeDrops.push({ component, added, actual }); store()
          await button(page, '撤销').click(); document = await saved(page, file, value => value.sequences[0].clips.length === beforeRange.length)
          assert.deepEqual(document.sequences[0].clips, beforeRange, '一次撤销完整恢复源分量拖入前的片段')
          assert.deepEqual(document.media.filter(media => basePaths.includes(media.path)).map(media => media.path), basePaths)
          assert.equal(document.media.find(media => media.id === avMedia.id).path, controls.audiovisual)
          await frame(0)
        }
        await button(page, '关闭源素材').click(); await page.waitForFunction(() => !document.querySelector('[data-video-edit-source-media]'))
        await closeVideoEditDockPanel(page, '源监视器')
        evidence.phases.push('真实范围波形、电平静音独奏、音视频节目互斥和源分量一次撤销'); store()
        evidence.currentPhase = '字幕面板、公共属性、保存重开和字幕文件'; store()
        const bareFrames = new Map()
        const subtitleFrames = [31, 32, 60, 87, 88, 119, 120, 149, 150]
        const activeSubtitleFrames = [32, 60, 87, 120, 149]
        for (const value of subtitleFrames) { await frame(value); bareFrames.set(value, await png(page, path.join(root, `without-caption-${value}.png`))) }
        const srtInput = path.join(root, 'input.srt'); const vttInput = path.join(root, 'input.vtt')
        fs.writeFileSync(srtInput, '1\n00:00:00,500 --> 00:00:01,500\n字幕导入 · 中文\n')
        fs.writeFileSync(vttInput, 'WEBVTT\n\n00:00:02.000 --> 00:00:02.500\nWebVTT 精确边界\n')
        await button(page, '面板').click(); await button(page, '字幕与标记').click()
        const content = panel(page, 'content'); await content.waitFor({ state: 'visible' })
        const importCaption = async input => { await dialogs(app, [input], file); await button(content, '导入或导出字幕').click(); await page.getByRole('menuitem', { name: '导入字幕…', exact: true }).click(); await content.getByLabel('节目偏移（帧）', { exact: true }).fill('0'); await button(content, '选择字幕文件').click() }
        await importCaption(srtInput); document = await saved(page, file, value => value.sequences[0].captions.length === 1)
        const caption = document.sequences[0].captions[0]; assert.equal(caption.start, 30); assert.equal(caption.duration, 60); assert.equal(caption.clipId, undefined)
        await content.locator(`[data-video-edit-timed-entry="${caption.id}"]`).click()
        await content.getByLabel('字幕文字', { exact: true }).fill('字幕范围 · 中文验收')
        await content.getByLabel('开始帧', { exact: true }).fill('32'); await content.getByLabel('时长（帧）', { exact: true }).fill('56'); await button(content, '保存修改').click()
        document = await saved(page, file, value => value.sequences[0].captions[0].start === 32 && value.sequences[0].captions[0].duration === 56 && value.sequences[0].captions[0].text === '字幕范围 · 中文验收')
        await importCaption(vttInput); await saved(page, file, value => value.sequences[0].captions.length === 2)
        await button(content, '新增字幕').click(); await content.getByLabel('字幕文字', { exact: true }).fill('跟随原片段')
        await content.getByLabel('内容锚定', { exact: true }).click(); await page.getByLabel('搜索锚定片段', { exact: true }).fill(baseVideo.name)
        await page.getByRole('button', { name: `锚定片段：${baseVideo.name}`, exact: true }).click()
        await content.getByLabel('开始帧', { exact: true }).fill('95'); await content.getByLabel('时长（帧）', { exact: true }).fill('10'); await button(content, '添加').click()
        document = await saved(page, file, value => value.sequences[0].captions.some(caption => caption.clipId === baseVideo.id && caption.start === 95 && caption.duration === 10))
        const anchored = document.sequences[0].captions.find(caption => caption.clipId === baseVideo.id)
        await content.locator(`[data-video-edit-timed-entry="${anchored.id}"]`).click(); await button(content, '删除').click(); await saved(page, file, value => value.sequences[0].captions.length === 2)
        await button(page, '撤销').click(); await saved(page, file, value => value.sequences[0].captions.some(caption => caption.id === anchored.id))
        await content.getByRole('tab', { name: '标记', exact: true }).click(); await button(content, '新增标记').click(); await content.getByLabel('标记名称', { exact: true }).fill('音画检查点'); await content.getByLabel('标记帧', { exact: true }).fill('45'); await button(content, '添加').click()
        document = await saved(page, file, value => value.sequences[0].markers.length === 1)
        const marker = document.sequences[0].markers[0]; const markerRef = { kind: 'video_edit.marker', id: `${project.id}:${marker.id}` }; const captionRef = { kind: 'video_edit.caption', id: `${project.id}:${caption.id}` }
        await change(markerRef, { 'video_edit.marker.name': 'Agent 标记回环', 'video_edit.marker.frame': 46 }); await change(captionRef, { 'video_edit.caption.text': 'Agent 字幕 · 中文验收' })
        await closeVideoEditDockPanel(page, '字幕与标记'); await focus(markerRef); await content.waitFor({ state: 'visible' }); await presented(page, 46)
        await focus(captionRef); await presented(page, 32); await content.getByRole('tab', { name: '字幕', exact: true }).click()
        assert.equal((await read(captionRef, ['video_edit.caption.start', 'video_edit.caption.duration', 'video_edit.caption.text'])).data.properties['video_edit.caption.text'], 'Agent 字幕 · 中文验收')
        const beforeDraft = readProject(file)
        await button(content, '新增字幕').click(); await content.getByLabel('字幕文字', { exact: true }).fill('隐藏面板不得提交此草稿'); await closeVideoEditDockPanel(page, '字幕与标记'); await focus(captionRef); await content.waitFor({ state: 'visible' })
        assert.equal(await content.getByLabel('字幕文字', { exact: true }).count(), 0)
        assert.deepEqual(readProject(file), beforeDraft)
        await content.locator(`[data-video-edit-timed-entry="${caption.id}"]`).click(); await button(content, '定位').click(); await presented(page, 32); await button(content, '取消').click()
        evidence.subtitlePixels = []
        for (const value of subtitleFrames) {
          await frame(value); const current = await png(page, path.join(root, `caption-boundary-${value}.png`))
          const difference = await pixelDifference(current.file, bareFrames.get(value).file, { left: 0, top: 1750, width: 3840, height: 350 })
          evidence.subtitlePixels.push({ frame: value, difference }); store()
          if (activeSubtitleFrames.includes(value)) { assert.ok(difference.changedChannels > 1000 && difference.maximumDelta > 10, '字幕首帧、内部和末帧必须实际烧录中文像素'); const outside = await pixelDifference(current.file, bareFrames.get(value).file, { left: 0, top: 0, width: 3840, height: 1300 }); assert.ok(outside.equal, '字幕不能改变范围外的画面') }
          else assert.ok(difference.equal, '半开字幕范围的前一帧和出点帧不能残留字幕')
        }
        const srtOutput = path.join(root, 'captions.srt'); const vttOutput = path.join(root, 'captions.vtt')
        await dialogs(app, [file], srtOutput); await button(content, '导入或导出字幕').click(); await page.getByRole('menuitem', { name: '导出 SRT（序列时间）', exact: true }).click()
        await poll(page, async () => fs.existsSync(srtOutput) ? fs.readFileSync(srtOutput, 'utf8') : '', value => value.includes('Agent 字幕 · 中文验收'), '手动SRT导出未写出')
        await dialogs(app, [file], vttOutput)
        const subtitleExport = await callTool(client, 'export_video_edit', operationEnvelope([await read(projectRef, ['video_edit.document.name'])], { documentRef: projectRef, format: 'vtt' }))
        assert.equal(subtitleExport.executionState, 'completed', JSON.stringify(subtitleExport)); assert.equal(subtitleExport.verificationState, 'verified', JSON.stringify(subtitleExport))
        const srt = fs.readFileSync(srtOutput, 'utf8'); const vtt = fs.readFileSync(vttOutput, 'utf8')
        assert.match(srt, /00:00:00,533 --> 00:00:01,467/); assert.match(vtt, /00:00:00\.533 --> 00:00:01\.467/); assert.ok(vtt.startsWith('WEBVTT'))
        assert.match(srt, /00:00:02,000 --> 00:00:02,500/); assert.match(vtt, /00:00:02\.000 --> 00:00:02\.500/)
        evidence.subtitles = { srtInput, vttInput, srtOutput, vttOutput, srt, vtt, publicExport: subtitleExport, markerRef, captionRef, anchoredCaptionId: anchored.id, hiddenDraftCancelled: true }
        document = await saved(page, file, value => value.sequences[0].markers[0].frame === 46 && value.sequences[0].captions[0].text === 'Agent 字幕 · 中文验收')
        assert.deepEqual(document.codeMaterials.map(material => material.versions), codeSources, '字幕编辑不得修改固定作者源码')
        assert.ok(!document.sequences[0].clips.some(clip => clip.id.startsWith('caption:')), '烧录用合成文字片段不能进入持久工程')
        const snapshot = structuredClone(document); await shot('monitor-caption-and-marker-agent-loop')
        await button(page, '关闭项目').click(); await waitReleased(page); await waitNativeWaveformsReleased(app, page); await open(file)
        assert.deepEqual(readProject(file), snapshot); await frame(60)
        const reopen = await png(page, path.join(root, 'caption-reopened-60.png')); assert.ok((await pixelDifference(reopen.file, path.join(root, 'caption-boundary-60.png'))).equal)
        evidence.savedReopened = true; await shot('monitor-caption-saved-reopened')
        evidence.currentPhase = '字幕4K60成片与44.1/48kHz声道输出回读'; store()
        const previewFrames = new Map()
        for (const value of subtitleFrames) { await frame(value); previewFrames.set(value, await png(page, path.join(root, `preview-${value}.png`))) }
        for (const settings of [{ rate: 48000, channels: 2 }, { rate: 44100, channels: 1 }]) {
          if (settings.rate !== 48000) await change(sequenceRef, { 'video_edit.sequence.sample_rate': settings.rate, 'video_edit.sequence.channels': settings.channels })
          const output = path.join(root, `caption-4k60-${settings.rate}-${settings.channels}-${Date.now()}.mp4`)
          await dialogs(app, [file], output)
          const startedAt = performance.now()
          if (settings.rate === 48000) await button(page, '导出视频').click()
          else { const result = await callTool(client, 'export_video_edit', operationEnvelope([await read(projectRef, ['video_edit.document.name'])], { documentRef: projectRef, format: 'mp4' })); assert.equal(result.executionState, 'completed', JSON.stringify(result)) }
          const task = await poll(page, () => callTool(client, 'query_video_edit_export', { documentRef: projectRef }), value => ['completed', 'failed', 'cancelled'].includes(value.data.task?.state), '正式视频导出没有结束', 2400)
          assert.equal(task.data.task.state, 'completed', JSON.stringify(task))
          const metadata = mediaProbe(ffprobePath, output); const video = metadata.streams.find(stream => stream.codec_type === 'video'); const audio = metadata.streams.find(stream => stream.codec_type === 'audio')
          assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(video.avg_frame_rate, '60/1'); assert.equal(Number(video.nb_frames), 180)
          assert.equal(Number(audio.sample_rate), settings.rate); assert.equal(audio.channels, settings.channels); assert.ok(Math.abs(Number(metadata.format.duration) - 3) < .1)
          const result = { output, metadata, settings, elapsedMs: performance.now() - startedAt, comparisons: [] }; evidence.exports.push(result); store()
          // First/last active subtitle frames and adjacent inactive frames all compare against actual full-resolution presentation.
          for (const value of settings.rate === 48000 ? [...previewFrames.keys()] : [31, 60, 88]) {
            const decoded = path.join(root, `export-${settings.rate}-${value}.png`)
            execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', output, '-vf', `select=eq(n\\,${value})`, '-frames:v', '1', decoded], { windowsHide: true, timeout: 60000 })
            const comparison = await pixelDifference(decoded, previewFrames.get(value).file); result.comparisons.push({ frame: value, ...comparison }); store()
            assert.ok(comparison.equal || comparison.psnr > 24, `4K60字幕预览/成片边界不一致：${JSON.stringify(comparison)}`)
            const region = { left: 0, top: 1750, width: 3840, height: 350 }
            const band = await pixelDifference(decoded, bareFrames.get(value).file, region)
            const renderedBand = await pixelDifference(decoded, previewFrames.get(value).file, region)
            result.comparisons.at(-1).subtitleBand = { withoutCaption: band, presentedCaption: renderedBand }
            if (activeSubtitleFrames.includes(value)) assert.ok(band.rms > renderedBand.rms * 1.5 && band.rms > .5, '成片字幕首帧、内部和末帧需显著匹配烧录画面，不能用整幅PSNR掩盖丢失文字')
          }
          const pcm = execFileSync(ffmpegPath, ['-v', 'error', '-i', output, '-vn', '-f', 'f32le', '-ac', String(settings.channels), '-ar', String(settings.rate), '-'], { windowsHide: true, timeout: 60000, maxBuffer: 4e6 })
          let square = 0; let peak = 0; for (let offset = 0; offset < pcm.length; offset += 4) { const value = pcm.readFloatLE(offset); assert.ok(Number.isFinite(value)); square += value * value; peak = Math.max(peak, Math.abs(value)) }
          result.audio = { sampleValues: pcm.length / 4, seconds: pcm.length / 4 / settings.channels / settings.rate, peak, rms: Math.sqrt(square / (pcm.length / 4)) }
          assert.ok(result.audio.rms > .01); assert.ok(Math.abs(result.audio.seconds - 3) < .1); store()
        }
        await button(page, '关闭项目').click(); await waitReleased(page); await waitNativeWaveformsReleased(app, page)
        await open(file)
        const reopenedSettings = (await read(sequenceRef, ['video_edit.sequence.sample_rate', 'video_edit.sequence.channels'])).data.properties
        assert.equal(reopenedSettings['video_edit.sequence.sample_rate'], 44100); assert.equal(reopenedSettings['video_edit.sequence.channels'], 1)
        evidence.reopenedAudioSettings = reopenedSettings
        await button(page, '关闭项目').click(); await waitReleased(page); await waitNativeWaveformsReleased(app, page)
        evidence.phases.push('SRT/VTT导入编辑、锚定删除撤销、MCP定位修改、隐藏草稿、保存重开、4K60字幕边界和两种音频格式'); store()
        evidence.currentPhase = '原4K60完整压力样本与500字幕有界列表'; store()
        const firstAt = performance.now(); await open(pressureFile); evidence.firstDecodeMs = performance.now() - firstAt
        const canvas = page.getByLabel('剪辑画面', { exact: true }); const pressureRef = { kind: 'video_edit.document', id: pressure.id }
        const pressureFrame = async (value, playing = false, direction = 1) => change(pressureRef, { 'video_edit.document.program_playback': { frame: value, playing, playbackDirection: direction } })
        evidence.firstFrame = await canvas.evaluate(canvas => ({ width: canvas.width, height: canvas.height, ...canvas.dataset }))
        evidence.trackBanks.pressure = await trackBanks(page)
        assert.equal(evidence.firstFrame.width, 3840); assert.equal(evidence.firstFrame.height, 2160); assert.equal(await page.locator('[data-video-edit-track]').count(), 32)
        evidence.visibleClipCount = await page.locator('[data-video-edit-clip]').count(); assert.ok(evidence.visibleClipCount > 0 && evidence.visibleClipCount < 20, '500片段只挂视口内DOM且默认能看到底层画面')
        await focus({ kind: 'video_edit.caption', id: `${pressure.id}:monitor-caption-0` }); await panel(page, 'content').waitFor({ state: 'visible' })
        evidence.visibleCaptionCount = await page.locator('[data-video-edit-timed-entry]').count(); assert.ok(evidence.visibleCaptionCount > 0 && evidence.visibleCaptionCount < 40, '500字幕须有界DOM')
        await closeVideoEditDockPanel(page, '字幕与标记'); await pressureFrame(0); await presented(page, 0)
        await pressureFrame(179); await presented(page, 179); await pressureFrame(0); await presented(page, 0)
        evidence.cachedFrame = await canvas.evaluate(canvas => ({ ...canvas.dataset })); evidence.playback = []
        for (const direction of [1, -1]) {
          const from = direction === 1 ? 0 : 179; const to = direction === 1 ? 179 : 0
          await pressureFrame(from, false, direction); await presented(page, from)
          await canvas.evaluate(canvas => {
            window.__monitorFrames = []
            window.__monitorFrameObserver = new MutationObserver(() => window.__monitorFrames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits), timestamps: canvas.dataset.sourceTimestamps }))
            window.__monitorFrameObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
          })
          await pressureFrame(from, true, direction)
          try { await page.waitForFunction(frame => window.__monitorFrames.some(sample => sample.frame === frame), to, { timeout: 90000 }) }
          finally { evidence.inFlightPlayback = await canvas.evaluate(canvas => ({ direction: Number(canvas.dataset.playbackDirection), data: { ...canvas.dataset }, samples: window.__monitorFrames })); store() }
          const samples = await page.evaluate(() => { window.__monitorFrameObserver.disconnect(); return window.__monitorFrames }); const clockStart = await canvas.evaluate(canvas => Number(canvas.dataset.playClockStartAt))
          await pressureFrame(to, false, direction)
          const wanted = Array.from({ length: 179 }, (_, index) => from + direction * (index + 1)); const updates = [...new Map(samples.filter(sample => wanted.includes(sample.frame)).map(sample => [sample.frame, sample])).values()]
          const missing = wanted.filter(frame => !updates.some(sample => sample.frame === frame)); const durationMs = updates.at(-1)?.at - clockStart
          const result = { direction, durationMs, actualFrames: updates.length, actualUpdatesPerSecond: updates.length * 1000 / durationMs, missing, gpuP95Ms: quantile(updates.map(sample => sample.gpuMs), .95), samples }; evidence.playback.push(result); store()
          assert.deepEqual(missing, []); assert.equal(updates.length, 179); assert.ok(result.actualUpdatesPerSecond >= 58, '完整原素材32轨500片段4K60实际更新率不得降低'); assert.ok(durationMs < 3100)
        }
        await pressureFrame(0); await presented(page, 0)
        const ruler = page.getByRole('slider', { name: '剪辑时间定位' }); const box = await ruler.boundingBox()
        await canvas.evaluate(canvas => {
          const ruler = document.querySelector('[aria-label="剪辑时间定位"]'); window.__monitorDrag = { inputs: [], frames: [] }
          window.__monitorInputObserver = new MutationObserver(() => window.__monitorDrag.inputs.push({ at: performance.now(), frame: Number(ruler.getAttribute('aria-valuenow')) }))
          window.__monitorInputObserver.observe(ruler, { attributes: true, attributeFilter: ['aria-valuenow'] })
          window.__monitorDragObserver = new MutationObserver(() => window.__monitorDrag.frames.push({ at: performance.now(), frame: Number(canvas.dataset.presentedFrame), requestedAt: Number(canvas.dataset.requestedAt), decodeMs: Number(canvas.dataset.decodeMs), gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits) }))
          window.__monitorDragObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-frame'] })
        })
        await page.mouse.move(box.x + 6, box.y + 12); await page.mouse.down(); const dragStart = performance.now()
        for (let index = 1; index <= 180; index++) { await page.mouse.move(box.x + index + .1, box.y + 12); const remaining = dragStart + index * 1000 / 60 - performance.now(); if (remaining > 0) await page.waitForTimeout(remaining) }
        const endedAt = await page.evaluate(() => performance.now()); await page.mouse.up(); await presented(page, 180)
        const drag = await page.evaluate(() => { window.__monitorInputObserver.disconnect(); window.__monitorDragObserver.disconnect(); return window.__monitorDrag })
        const during = drag.frames.filter(sample => sample.at <= endedAt); const latencies = during.map(sample => { const input = drag.inputs.find(input => input.frame === sample.frame && input.at <= sample.at); return input ? sample.at - input.at : null }).filter(value => value !== null)
        assert.ok(latencies.length > 0); const final = drag.frames.findLast(sample => sample.frame === 180); assert.ok(final)
        evidence.drag = { ...drag, actualUpdatesPerSecond: during.length * 1000 / (endedAt - (drag.inputs[0]?.at ?? endedAt)), latencyP95Ms: quantile(latencies, .95), finalFrame: final.frame, finalSettleMs: Math.max(0, final.at - endedAt) }; store()
        assert.ok(evidence.drag.actualUpdatesPerSecond >= 58); assert.ok(evidence.drag.latencyP95Ms < 100); assert.ok(evidence.drag.finalSettleMs < 100)
        await shot('monitor-32-track-500-clip-original-4k60'); await button(page, '关闭项目').click(); await waitReleased(page)
        evidence.nativeWaveforms = await waitNativeWaveformsReleased(app, page); evidence.resources = await workerSnapshot(page)
        assert.equal(evidence.resources.live, 0); assert.equal(evidence.nativeWaveforms.liveWorkers, 0); assert.equal(evidence.nativeWaveforms.liveProcesses, 0)
        assert.ok(evidence.nativeWaveforms.workers.length > 0); assert.ok(evidence.nativeWaveforms.processes.length > 0); assert.ok(evidence.nativeWaveforms.peakWorkers <= 2); assert.ok(evidence.nativeWaveforms.peakProcesses <= 2)
        assert.equal(await page.locator('[data-video-edit-source-media]').count(), 0)
        for (const original of evidence.originalPaths) { const current = fs.statSync(original.file); assert.equal(current.size, original.size); assert.equal(current.mtimeMs, original.mtimeMs) }
        evidence.originalFilesUnchanged = true; evidence.phases.push('完整原4K60压力实际帧、拖动延迟、500字幕列表与原生/GPU资源释放'); evidence.completed = true; delete evidence.currentPhase; store()
      } catch (error) {
        evidence.failedPresentation = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({ ...canvas.dataset })).catch(() => null)
        evidence.failedTimeline = await page.locator('[data-video-edit-timeline-viewport]').evaluate(host => ({ scrollTop: host.scrollTop, scrollLeft: host.scrollLeft, height: host.clientHeight, width: host.clientWidth, top: host.getBoundingClientRect().top, tracks: [...host.querySelectorAll('[data-video-edit-track]')].map(row => ({ index: Number(row.dataset.trackIndex), kind: row.dataset.trackKind, top: row.getBoundingClientRect().top, height: row.clientHeight })), visibleClips: [...host.querySelectorAll('[data-video-edit-clip]')].map(clip => clip.dataset.videoEditClip) })).catch(() => null)
        evidence.failed = error instanceof Error ? { message: error.message, stack: error.stack } : String(error); store()
        await shot('video-edit-monitor-failed').catch(() => {}); throw error
      } finally {
        await page.mouse.up().catch(() => {})
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        await button(page, '关闭项目').click().catch(() => {})
        if (renderObserved) { await waitReleased(page).catch(error => { evidence.releaseFailure = String(error); evidence.completed = false }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        if (nativeObserved) {
          await waitNativeWaveformsReleased(app, page).catch(error => { evidence.nativeReleaseFailure = String(error); evidence.completed = false })
          evidence.nativeWaveforms = await nativeWaveformSnapshot(app).catch(() => evidence.nativeWaveforms); await restoreNativeWaveformObservers(app).catch(() => {})
        }
        await page.evaluate(previous => {
          window.__monitorSourceFramesStop = true
          for (const key of ['__monitorFrameObserver', '__monitorInputObserver', '__monitorDragObserver']) window[key]?.disconnect()
          window.__videoLayoutObservers?.forEach(observer => observer.disconnect())
          if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker
          if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1'); else if (typeof previous === 'string') localStorage.setItem('henji.videoEdit.dockLayout.v1', previous)
        }, previousLayout).catch(() => {})
        store()
      }
    },
  }
}
module.exports = { createVideoEditMonitorScene, dialogs, saved, presented, png, pixelDifference, mediaProbe, trackBanks, quantile }
