const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
const menuItem = (page, name) => page.getByRole('menuitem', { name, exact: true })
const entry = (page, id) => page.locator(`[data-video-edit-project-entry="${id}"]`)
async function dialogs(app, openPaths, savePath) {
  await app.evaluate(({ dialog }, values) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: values.openPaths })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: values.savePath })
  }, { openPaths, savePath })
}
async function saved(page, file, test) {
  let document
  for (let attempt = 0; attempt < 100; attempt++) {
    document = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (test(document)) return document
    await page.waitForTimeout(50)
  }
  assert.fail(`工程没有静默保存预期内容：${JSON.stringify(document)}`)
}
async function ready(page, kind) {
  await page.waitForFunction(kind => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready'
    && document.querySelector(`[data-video-edit-source-media="${kind}"]`), kind, { timeout: 15000 })
}
async function renameItem(page, id, name, tags, bin) {
  await entry(page, id).click({ button: 'right' }); await menuItem(page, '重命名、标签与移动').click()
  await page.getByLabel('项目项名称', { exact: true }).fill(name)
  await page.getByLabel('项目项标签', { exact: true }).fill(tags)
  await page.getByLabel('移动到素材箱', { exact: true }).selectOption(bin)
  await button(page, '保存').click(); await page.waitForTimeout(250)
}
/**
 * Seeks the source monitor and waits for the picture (or sound clock) confirmed at that time. The native primary path
 * (tasks 2.2, 2.3) shows a video item on the render-session canvas and plays a sound item through an element-less
 * sound view, both confirming `data-presented-time-us`; a video confirms the real frame showing at the time (at most
 * one frame earlier), a sound view the exact clock. The browser backend (forced by the diagnostic setting) keeps the
 * media elements and their `currentTime`.
 */
async function sourceSeek(page, seconds, native, frameSeconds = 0) {
  const field = page.getByLabel('源素材定位秒', { exact: true })
  await field.fill(String(seconds)); await field.press('Enter')
  await page.waitForFunction(({ time, native, frame }) => {
    const media = document.querySelector('[data-video-edit-source-media]')
    if (document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus !== 'ready' || !media) return false
    if (!native) return Math.abs(media.currentTime - time) < 0.001
    if (media.dataset.presentedTimeUs === undefined) return false
    const shown = Number(media.dataset.presentedTimeUs) / 1e6
    return shown <= time + 1e-6 && shown > time - frame - 1e-6
  }, { time: seconds, native, frame: frameSeconds }, { timeout: 15000 })
}
/** The source monitor's own elements: native canvas / sound view, or browser media elements, never both. */
async function sourceElements(page) {
  return page.locator('[data-video-edit-source-host]').evaluate(host => ({
    video: host.querySelectorAll('video').length, audio: host.querySelectorAll('audio').length,
    canvas: host.querySelectorAll('canvas[data-video-edit-source-canvas]').length, sound: host.querySelectorAll('[data-video-edit-source-sound]').length,
  }))
}
function createVideoEditProjectSourceScene() {
  return {
    id: 'video-edit-project-source', surface: '剪辑', name: '剪辑-项目素材与真实源监视器', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-project-source'); fs.mkdirSync(root, { recursive: true })
      const existing = path.resolve('node_modules/.cache/video-edit-probe/3840-60.mp4')
      const video = fs.existsSync(existing) ? existing : path.join(root, '4k60.mp4')
      const picture = path.join(root, 'picture.png'); const audio = path.join(root, 'audio.wav')
      const { ffmpegPath } = require('./mediaBinaries.cjs')
      const ffmpeg = args => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, stdio: 'pipe' })
      if (!fs.existsSync(video)) ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=60', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-g', '60', '-pix_fmt', 'yuv420p', video])
      if (!fs.existsSync(picture)) ffmpeg(['-f', 'lavfi', '-i', 'color=c=orange:size=320x180', '-frames:v', '1', picture])
      if (!fs.existsSync(audio)) ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3', audio])
      const file = path.join(root, 'project.henji-video'); const evidence = { sourcePaths: { video, picture, audio }, phases: [] }
      const originalStats = [video, picture, audio].map(file => ({ file, size: fs.statSync(file).size, mtime: fs.statSync(file).mtimeMs }))
      let client
      await observeWorkers(page)
      try {
        // Native decoding is the primary path (2.3): local video and sound items play through native source views; the
        // diagnostic setting forcing the browser keeps the media elements. Each mode asserts its own real elements.
        const status = await page.evaluate(() => window.henjiNative.videoDecoder.status())
        const native = status.forcedBackend !== 'browser'
        if (native) assert.equal(status.available, true, '本机原生解码服务应可用')
        evidence.sourceBackend = native ? 'native' : 'browser'
        const FRAME = 1 / 60
        await button(page, '剪辑').click(); await dialogs(app, [video, audio], file); await button(page, '新建工程').click()
        const list = page.getByLabel('项目项列表', { exact: true }); const listRect = await list.boundingBox()
        await list.dblclick({ position: { x: 24, y: listRect.height - 20 } })
        let document = await saved(page, file, value => value.media.length === 2)
        const videoId = document.items.find(item => item.kind === 'video').id; const audioId = document.items.find(item => item.kind === 'audio').id
        assert.deepEqual(document.media.map(media => media.path.toLowerCase()).sort(), [video, audio].map(value => value.toLowerCase()).sort())
        assert.equal(document.sequences[0].clips.length, 0, '导入只创建项目项')
        const asset = await page.evaluate(picture => window.henjiNative.assetLibrary.createAsset({ filePath: picture, mediaType: 'image', source: 'external', displayName: '源预览资产图片' }), picture)
        await button(page, '资产库').click()
        const card = page.locator('[data-asset-card]').filter({ hasText: '源预览资产图片' })
        await card.waitFor({ state: 'visible', timeout: 10000 })
        await card.dragTo(list, { targetPosition: { x: 12, y: listRect.height - 30 } })
        document = await saved(page, file, value => value.media.length === 3)
        const imageMedia = document.media.find(media => media.kind === 'image'); const imageId = document.items.find(item => item.mediaId === imageMedia.id).id
        assert.equal(imageMedia.path.toLowerCase(), picture.toLowerCase()); assert.equal(imageMedia.assetId, asset.id)
        // Clicking the uncovered project area closes the shared asset overlay.
        await list.click({ position: { x: 12, y: listRect.height - 30 } })
        await page.locator('[data-asset-floating-panel]').waitFor({ state: 'hidden' })
        await button(page, '新建素材箱').click(); await page.getByLabel('项目项名称', { exact: true }).fill('镜头素材'); await button(page, '保存').click()
        document = await saved(page, file, value => value.bins.length === 1)
        const binId = document.bins[0].id
        await button(page, '工程根目录').click(); await renameItem(page, videoId, '4K60 原镜头', '片头,压力样本', binId)
        await page.locator(`[data-video-edit-bin="${binId}"]`).click()
        await page.getByLabel('搜索项目素材', { exact: true }).fill('压力样本'); await entry(page, videoId).waitFor({ state: 'visible' })
        await page.getByLabel('搜索项目素材', { exact: true }).fill('')
        document = await saved(page, file, value => value.items.find(item => item.id === videoId)?.tags?.includes('压力样本'))
        evidence.projectOrganization = { binId, videoId, assetId: imageMedia.assetId, originalPaths: true, tags: ['片头', '压力样本'] }
        const thumbnail = await page.evaluate(video => window.henjiNative.video.generateThumbnailBytes({ source: video, cache: true, requestId: crypto.randomUUID() }), video)
        const thumbnailMtime = fs.statSync(thumbnail.cachePath).mtimeMs
        const cachedAt = performance.now()
        const cached = await page.evaluate(video => window.henjiNative.video.generateThumbnailBytes({ source: video, cache: true, requestId: crypto.randomUUID() }), video)
        evidence.thumbnailCache = { hitMs: performance.now() - cachedAt, path: cached.cachePath, preservedMtime: fs.statSync(cached.cachePath).mtimeMs === thumbnailMtime }
        assert.equal(cached.cachePath, thumbnail.cachePath); assert.ok(evidence.thumbnailCache.preservedMtime)

        const programmeFrame = await page.getByRole('slider', { name: '剪辑时间定位' }).getAttribute('aria-valuenow')
        const savedBeforePreview = fs.readFileSync(file, 'utf8')
        const openedAt = performance.now(); await entry(page, videoId).dblclick(); await ready(page, 'video')
        evidence.firstSourcePresentationMs = performance.now() - openedAt
        evidence.sourceVideo = await page.locator('[data-video-edit-source-media="video"]').evaluate(media => media instanceof HTMLVideoElement
          ? { element: 'video', width: media.videoWidth, height: media.videoHeight, src: media.currentSrc }
          : { element: media.localName, width: media.width, height: media.height, presentedTimeUs: Number(media.dataset.presentedTimeUs) })
        evidence.sourceVideo.elements = await sourceElements(page)
        assert.deepEqual(evidence.sourceVideo.elements, native ? { video: 0, audio: 0, canvas: 1, sound: 0 } : { video: 1, audio: 0, canvas: 0, sound: 0 }, '源监视器视频元素与后端不符')
        assert.equal(evidence.sourceVideo.element, native ? 'canvas' : 'video')
        assert.equal(evidence.sourceVideo.width, 3840); assert.equal(evidence.sourceVideo.height, 2160)
        const seekAt = performance.now(); await sourceSeek(page, 0.5, native, FRAME); evidence.sourceSeekMs = performance.now() - seekAt
        await capture('video-project-source-4k60')
        const identity = await authorizeMcpConnection(page, { name: '项目源回环', allowWrites: true, allowDestructive: true })
        client = await connectMcpClient(identity.config, 'Video project source Reality')
        const ref = { kind: 'video_edit.source', id: `${document.id}:source` }
        const baseline = await callTool(client, 'read_application_entity', { ref, propertyIds: ['video_edit.source.time_us', 'video_edit.source.presented_time_us'] })
        assert.equal(baseline.data.properties['video_edit.source.time_us'], 500000)
        const change = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '真实源定位与音量', changes: [{ kind: 'set_properties', entityType: ref.kind, target: ref, properties: { 'video_edit.source.time_us': 1000000, 'video_edit.source.volume': 0.2 } }] }))
        assert.equal(change.executionState, 'completed', JSON.stringify(change))
        if (native) {
          // The native view confirms the picture showing at 1s on its canvas; the volume drives its sound session.
          await page.waitForFunction(frame => { const shown = Number(document.querySelector('[data-video-edit-source-canvas]')?.dataset.presentedTimeUs); return shown <= 1000000 && shown > 1000000 - frame * 1e6 }, FRAME, { timeout: 15000 })
        }
        evidence.sourceMcp = (await callTool(client, 'read_application_entity', { ref, propertyIds: ['video_edit.source.time_us', 'video_edit.source.presented_time_us', 'video_edit.source.volume'] })).data.properties
        if (native) {
          assert.equal(evidence.sourceMcp['video_edit.source.time_us'], 1000000); assert.equal(evidence.sourceMcp['video_edit.source.volume'], 0.2)
          assert.equal(evidence.sourceMcp['video_edit.source.presented_time_us'], Number(await page.locator('[data-video-edit-source-canvas]').getAttribute('data-presented-time-us')), '源实体报告的呈现时间就是画布确认的画面')
        } else assert.deepEqual(await page.locator('[data-video-edit-source-media="video"]').evaluate(video => ({ time: video.currentTime, volume: video.volume })), { time: 1, volume: 0.2 })
        await sourceSeek(page, 0, native, FRAME)
        // Count actually presented pictures: media presentation callbacks with frame counters (browser) or the native
        // canvas's confirmed timestamps (every picture the render session presents); never rAF callbacks.
        if (native) await page.locator('[data-video-edit-source-canvas]').evaluate(canvas => {
          window.__sourceFrames = []
          window.__sourceObserver = new MutationObserver(() => window.__sourceFrames.push({ at: performance.now(), mediaTime: Number(canvas.dataset.presentedTimeUs) / 1e6 }))
          window.__sourceObserver.observe(canvas, { attributes: true, attributeFilter: ['data-presented-time-us'] })
        })
        else await page.locator('[data-video-edit-source-media="video"]').evaluate(video => {
          window.__sourceFrames = []
          const record = (at, metadata) => { window.__sourceFrames.push({ at, mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames, width: metadata.width, height: metadata.height }); if (!video.ended) video.requestVideoFrameCallback(record) }
          video.requestVideoFrameCallback(record)
        })
        await button(page, '播放源素材').click()
        if (native) { await button(page, '暂停源素材').waitFor({ state: 'visible' }); await button(page, '播放源素材').waitFor({ state: 'visible', timeout: 15000 }) }
        else await page.waitForFunction(() => document.querySelector('[data-video-edit-source-media="video"]')?.ended, null, { timeout: 15000 })
        evidence.sourcePlayback = native
          ? await page.evaluate(() => { window.__sourceObserver.disconnect(); return { frames: window.__sourceFrames.filter((entry, index, all) => index === 0 || entry.mediaTime !== all[index - 1].mediaTime) } })
          : await page.locator('[data-video-edit-source-media="video"]').evaluate(video => ({ frames: window.__sourceFrames, quality: video.getVideoPlaybackQuality().toJSON?.() ?? { totalVideoFrames: video.getVideoPlaybackQuality().totalVideoFrames, droppedVideoFrames: video.getVideoPlaybackQuality().droppedVideoFrames } }))
        const frames = evidence.sourcePlayback.frames; assert.ok(frames.length >= 170, `4K60 源需呈现真实视频帧：${frames.length}`)
        if (native) assert.ok(frames.every((entry, index) => index === 0 || entry.mediaTime > frames[index - 1].mediaTime), '原生源画面正向播放不能倒退')
        const mediaElapsed = frames.at(-1).mediaTime - frames[0].mediaTime; const elapsed = (frames.at(-1).at - frames[0].at) / 1000
        evidence.sourcePlayback.actualUpdatesPerSecond = (frames.length - 1) / elapsed
        assert.ok(evidence.sourcePlayback.actualUpdatesPerSecond >= 58, `4K60 实际源画面更新：${evidence.sourcePlayback.actualUpdatesPerSecond}`)
        assert.ok(Math.abs(mediaElapsed - elapsed) < 0.15, '源播放必须保持真实时长')
        await button(page, '关闭源素材').click(); await page.waitForFunction(() => !document.querySelector('[data-video-edit-source-media]'))
        const beforeReopen = performance.now(); await entry(page, videoId).dblclick(); await ready(page, 'video'); evidence.sourceReopenMs = performance.now() - beforeReopen
        await button(page, '关闭源素材').click(); await button(page, '工程根目录').click()
        await entry(page, audioId).dblclick(); await ready(page, 'audio'); await sourceSeek(page, 0.75, native)
        // One sound reader either way: the native sound view (no media element) or one controlled audio element.
        assert.deepEqual(await sourceElements(page), native ? { video: 0, audio: 0, canvas: 0, sound: 1 } : { video: 0, audio: 1, canvas: 0, sound: 0 }, '源监视器声音元素与后端不符')
        assert.equal(await page.getByLabel('源监视器', { exact: true }).locator('audio').count(), native ? 0 : 1, '受控音频控件不得另建解码器')
        await capture('video-project-source-audio'); await button(page, '关闭源素材').click()
        await entry(page, imageId).dblclick(); await ready(page, 'image'); await capture('video-project-source-image')
        await button(page, '关闭源监视器').click(); await page.waitForFunction(() => !document.querySelector('[data-video-edit-source-media]'))
        assert.equal(await page.getByRole('slider', { name: '剪辑时间定位' }).getAttribute('aria-valuenow'), programmeFrame)
        assert.equal(fs.readFileSync(file, 'utf8'), savedBeforePreview, '源预览不写工程或改变节目会话')
        evidence.previewIsolation = { programmeFrame, projectUnchanged: true, audioDecoders: 1, hiddenSourceReleased: true }

        await page.locator(`[data-video-edit-bin="${binId}"]`).click()
        await entry(page, videoId).click({ button: 'right' }); await menuItem(page, '按此素材新建序列').click(); await page.getByLabel('序列名称', { exact: true }).fill('4K60 匹配序列'); await button(page, '确定').click()
        document = await saved(page, file, value => value.sequences.some(sequence => sequence.name === '4K60 匹配序列'))
        const sequence = document.sequences.find(sequence => sequence.name === '4K60 匹配序列')
        // A video with sound becomes its picture plus a linked sound clip (task 2.6).
        const videoHasAudio = document.media.find(media => media.id === document.items.find(item => item.id === videoId).mediaId).hasAudio === true
        assert.equal(sequence.width, 3840); assert.equal(sequence.height, 2160); assert.deepEqual(sequence.frameRate, { numerator: 60, denominator: 1 }); assert.equal(sequence.clips.length, videoHasAudio ? 2 : 1)
        await button(page, '序列设置').click(); await page.getByLabel('音频采样率', { exact: true }).selectOption('44100'); await page.getByLabel('声道', { exact: true }).selectOption('1'); await button(page, '确定').click()
        await saved(page, file, value => value.sequences.find(item => item.id === sequence.id)?.sampleRate === 44100)
        await capture('video-project-matched-sequence')
        await page.getByRole('tab', { name: '序列 1', exact: true }).click()
        // Timeline content: ruler row (28px) above track rows; lanes start after the 208px track header.
        const timeline = page.locator('[data-video-edit-timeline-content]')
        await entry(page, videoId).dragTo(timeline, { targetPosition: { x: 208 + 6, y: 28 + 32 + 16 } })
        document = await saved(page, file, value => value.sequences.length === 3)
        const dropped = document.sequences.at(-1)
        assert.equal(dropped.width, 3840); assert.deepEqual(dropped.frameRate, { numerator: 60, denominator: 1 }); assert.equal(dropped.clips[0].start, 0)
        evidence.emptyTimelineDrop = { newSequenceId: dropped.id, originalEmpty: document.sequences[0].clips.length === 0 }
        await button(page, '关闭工程').click(); await waitReleased(page)
        await dialogs(app, [file], file); await button(page, '打开工程').click()
        await page.locator(`[data-video-edit-bin="${binId}"]`).click()
        await entry(page, sequence.id).dblclick(); await button(page, '序列设置').click()
        assert.equal(await page.getByLabel('音频采样率', { exact: true }).inputValue(), '44100'); assert.equal(await page.getByLabel('声道', { exact: true }).inputValue(), '1')
        await button(page, '取消').click(); evidence.savedReopen = { matchedSequenceId: sequence.id, sampleRate: 44100, channels: 1, tagsPersisted: true }
        await page.locator(`[data-video-edit-bin="${binId}"]`).click({ button: 'right' }); await menuItem(page, '重命名与移动素材箱').click()
        await page.getByLabel('项目项名称', { exact: true }).fill('已重命名镜头箱'); await button(page, '保存').click()
        await saved(page, file, value => value.bins[0].name === '已重命名镜头箱')
        await button(page, '工程根目录').click(); await entry(page, imageId).click({ button: 'right' }); await menuItem(page, '从工程移除').click()
        await saved(page, file, value => value.media.length === 2); assert.ok(fs.existsSync(picture), '移除项目引用不能删除源文件')
        await button(page, '撤销').click(); await saved(page, file, value => value.media.length === 3)
        await button(page, '关闭工程').click(); await waitReleased(page)

        // Maximum project-item and bin scale; all sources are existing original references.
        const scale = JSON.parse(fs.readFileSync(file, 'utf8')); scale.id = 'project-source-scale'; scale.name = '500项目项压力工程'
        scale.bins = Array.from({ length: 200 }, (_, index) => ({ id: `scale-bin-${index}`, name: `素材箱 ${String(index).padStart(3, '0')}` }))
        const sourceItem = scale.items.find(item => item.id === videoId)
        scale.items = Array.from({ length: 500 }, (_, index) => ({ ...sourceItem, id: `scale-item-${index}`, name: `4K60 ${String(index).padStart(3, '0')}`, binId: undefined }))
        scale.sequences = [scale.sequences[0]]; scale.sequences[0].clips = []; scale.sequences[0].annotations = []
        const scaleFile = path.join(root, 'scale.henji-video'); fs.writeFileSync(scaleFile, JSON.stringify(scale))
        const scaleStarted = performance.now(); await dialogs(app, [scaleFile], scaleFile); await button(page, '打开工程').click(); await entry(page, 'scale-item-0').waitFor({ state: 'visible' })
        evidence.scale = { items: 500, bins: 200, firstVisibleMs: performance.now() - scaleStarted, mountedItems: await page.locator('[data-video-edit-project-entry]').count(), mountedBins: await page.locator('[data-video-edit-bin]').count() }
        assert.ok(evidence.scale.mountedItems < 80); assert.ok(evidence.scale.mountedBins < 80)
        await button(page, '缩略图视图').click(); await page.waitForTimeout(500)
        evidence.scale.gridMountedItems = await page.locator('[data-video-edit-project-entry]').count(); assert.ok(evidence.scale.gridMountedItems < 80)
        await capture('video-project-scale-grid')
        await button(page, '列表视图').click()
        await entry(page, 'scale-item-0').waitFor({ state: 'visible' })
        await page.getByLabel('项目项列表', { exact: true }).hover(); await page.mouse.wheel(0, 50000)
        await entry(page, 'scale-item-499').waitFor({ state: 'visible' }); await capture('video-project-scale-end')
        await button(page, '关闭工程').click(); await waitReleased(page)
        // Render workers at once: the program's, plus on the native path the source view's picture session and, for an
        // item with sound, its sound session (tasks 2.2, 2.3); the browser path's source monitor uses media elements.
        const expectedPeak = 1 + (native ? 1 + (videoHasAudio ? 1 : 0) : 0)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0); assert.equal(evidence.resources.peakLive, expectedPeak, `同时运行的渲染 Worker 应为 ${expectedPeak}`)
        assert.equal(await page.locator('[data-video-edit-source-media]').count(), 0)
        for (const original of originalStats) { const current = fs.statSync(original.file); assert.equal(current.size, original.size); assert.equal(current.mtimeMs, original.mtime) }
        evidence.completed = true
      } catch (error) {
        evidence.failed = String(error); await capture('video-project-source-failed').catch(() => {}); throw error
      } finally {
        evidence.resources = await workerSnapshot(page).catch(() => evidence.resources)
        fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
        await client?.close(); await disableMcp(page).catch(() => {})
        await page.evaluate(() => { window.__videoLayoutObservers.forEach(observer => observer.disconnect()); window.Worker = window.__videoLayoutNativeWorker }).catch(() => {})
      }
    },
  }
}
module.exports = { createVideoEditProjectSourceScene }
