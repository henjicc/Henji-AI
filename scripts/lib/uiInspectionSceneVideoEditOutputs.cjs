const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { execFileSync } = require('node:child_process')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented, png, pixelDifference, mediaProbe, trackBanks } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const normalized = value => value.replaceAll('/', '\\').toLowerCase()

/** Full-resolution real Program pixels and actual encoder output enter the existing library/Canvas services. */
function createVideoEditOutputsScene({ canvasFixtureProjectId }) {
  return { id: 'video-edit-outputs', surface: '剪辑', name: '剪辑-真实4K选帧成片同源资产收录与画布复用', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-outputs'); fs.mkdirSync(root, { recursive: true })
      const fixture = JSON.parse(fs.readFileSync(path.resolve('node_modules/.cache/video-edit-composite-edit/mixed.henji-video'), 'utf8'))
      fixture.id = 'video-edit-output-collection'; fixture.name = '真实混剪输出收录'; fixture.revision = 0
      const file = path.join(root, 'outputs.henji-video'); fs.writeFileSync(file, JSON.stringify(fixture))
      const selectedPath = path.join(root, `program-90-${Date.now()}.png`); const exportPath = path.join(root, `mixed-${Date.now()}.mp4`)
      const originals = fixture.media.map(media => ({ file: media.path, size: fs.statSync(media.path).size, mtimeMs: fs.statSync(media.path).mtimeMs }))
      const evidence = { completed: false, phases: [], captures: [], originals }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      let client; let previousLayout; let observed = false
      try {
        evidence.display = await app.evaluate(({ BrowserWindow, screen }, point) => {
          const host = BrowserWindow.getAllWindows().find(window => window.getTitle() === '痕迹AI') ?? BrowserWindow.getAllWindows()[0]
          const bounds = host.getBounds(); const current = screen.getDisplayMatching(bounds); const coordinates = point?.split(',').map(Number)
          const selected = coordinates ? screen.getAllDisplays().find(display => coordinates[0] >= display.bounds.x && coordinates[0] < display.bounds.x + display.bounds.width && coordinates[1] >= display.bounds.y && coordinates[1] < display.bounds.y + display.bounds.height) : undefined
          return { windowBounds: bounds, id: current.id, primary: current.id === screen.getPrimaryDisplay().id, preferredId: selected?.id }
        }, process.env.HENJI_DEV_DISPLAY_POINT)
        if (process.env.HENJI_DEV_DISPLAY_POINT) { assert.equal(evidence.display.id, evidence.display.preferredId); assert.equal(evidence.display.primary, false) }
        await button(page, '剪辑').click()
        if (await button(page, '关闭工程').isVisible()) await button(page, '关闭工程').click()
        await button(page, '生成').click(); previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1')); await observeWorkers(page); observed = true; await button(page, '剪辑').click()
        await dialogs(app, [file], file); await button(page, '打开工程').click(); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '剪辑输出收录验收', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji output collection Reality')
        const projectRef = { kind: 'video_edit.project', id: fixture.id }
        const baseline = await callTool(client, 'read_application_entity', { ref: projectRef, propertyIds: ['video_edit.project.program_playback'] })
        await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '定位真实节目选帧', changes: [{ kind: 'set_properties', entityType: 'video_edit.project', target: projectRef, properties: { 'video_edit.project.program_playback': { frame: 90, playing: false, playbackDirection: 1 } } }] }))
        await presented(page, 90)
        evidence.program = await png(page, path.join(root, 'program-before-capture.png')); evidence.trackBanks = await trackBanks(page)
        const before = await workerSnapshot(page); await dialogs(app, [file], selectedPath)
        const captureAt = performance.now(); await button(page, '选帧加入资产库').click()
        await page.locator('[data-asset-floating-panel]').waitFor({ state: 'visible', timeout: 30000 })
        await page.locator('[data-asset-card]').filter({ hasText: `${fixture.name} · 帧 90` }).waitFor({ state: 'visible', timeout: 30000 })
        evidence.captureAndCollectionMs = performance.now() - captureAt
        const selected = await page.evaluate(async keyword => {
          const page = await window.henjiNative.assetLibrary.queryAssets({ keyword, pageSize: 50 }); const asset = page.items.find(asset => asset.mediaType === 'image')
          return asset ? window.henjiNative.assetLibrary.inspectAsset(asset.id) : null
        }, fixture.name)
        assert.ok(selected); assert.equal(normalized(selected.filePath), normalized(selectedPath)); assert.equal(selected.source, 'video-edit'); assert.equal(selected.inspectionStatus, 'ready')
        assert.equal(selected.width, 3840); assert.equal(selected.height, 2160); assert.match(selected.contentIdentity, /^[a-f0-9]{64}$/)
        const selectedPixels = await sharp(selectedPath).metadata(); assert.equal(selectedPixels.width, 3840); assert.equal(selectedPixels.height, 2160)
        evidence.captureDifference = await pixelDifference(evidence.program.file, selectedPath); assert.ok(evidence.captureDifference.equal)
        const after = await workerSnapshot(page); assert.equal(after.workers.length, before.workers.length); assert.equal(after.live, before.live)
        evidence.captureResources = { before, after }; evidence.frameAsset = selected; evidence.phases.push('真实节目4K PNG逐像素匹配，收录不创建额外Worker'); await shot('outputs-frame-collected-original-4k')
        // Calling the same public service must reuse the published PNG and existing native asset row.
        const readFrame = await callTool(client, 'read_application_entity', { ref: projectRef })
        const frameResult = await callTool(client, 'collect_video_edit_output', operationEnvelope([readFrame], { projectRef, kind: 'frame', frame: 90 }))
        assert.equal(frameResult.executionState, 'completed', JSON.stringify(frameResult)); assert.equal(frameResult.verificationState, 'verified', JSON.stringify(frameResult)); assert.equal(frameResult.result.data.resultRef.id, selected.id)
        evidence.publicFrame = frameResult; await page.getByLabel('项目项列表', { exact: true }).click({ position: { x: 12, y: 25 } }); await page.locator('[data-asset-floating-panel]').waitFor({ state: 'hidden' })
        await dialogs(app, [file], exportPath); const exportAt = performance.now(); await button(page, '导出视频').click()
        let task
        for (let attempt = 0; attempt < 2400; attempt++) { task = await callTool(client, 'query_video_edit_export', { projectRef }); if (['completed', 'failed', 'cancelled'].includes(task.data.task?.state)) break; await page.waitForTimeout(50) }
        assert.equal(task.data.task?.state, 'completed', JSON.stringify(task))
        const { ffmpegPath, ffprobePath } = require('ffmpeg-ffprobe-static'); const metadata = mediaProbe(ffprobePath, exportPath)
        const video = metadata.streams.find(stream => stream.codec_type === 'video'); const audio = metadata.streams.find(stream => stream.codec_type === 'audio')
        assert.equal(video.width, 3840); assert.equal(video.height, 2160); assert.equal(video.avg_frame_rate, '60/1'); assert.equal(Number(video.nb_frames), 180); assert.equal(Number(audio.sample_rate), 48000); assert.equal(audio.channels, 2)
        const decoded = path.join(root, 'export-90.png'); execFileSync(ffmpegPath, ['-v', 'error', '-y', '-i', exportPath, '-vf', 'select=eq(n\\,90)', '-frames:v', '1', decoded], { windowsHide: true, timeout: 60000 })
        const comparison = await pixelDifference(decoded, selectedPath); assert.ok(comparison.psnr === null || comparison.psnr >= 30)
        evidence.export = { path: exportPath, elapsedMs: performance.now() - exportAt, metadata, comparison }; store()
        await button(page, '成片加入资产库').click(); await page.locator('[data-asset-floating-panel]').waitFor({ state: 'visible', timeout: 30000 })
        await page.locator('[data-asset-card]').filter({ hasText: '· 成片' }).waitFor({ state: 'visible', timeout: 30000 })
        const movie = await page.evaluate(async keyword => {
          const page = await window.henjiNative.assetLibrary.queryAssets({ keyword, pageSize: 50 }); const asset = page.items.find(asset => asset.mediaType === 'video')
          return asset ? window.henjiNative.assetLibrary.inspectAsset(asset.id) : null
        }, fixture.sequences[0].name)
        assert.ok(movie); assert.equal(normalized(movie.filePath), normalized(exportPath)); assert.equal(movie.source, 'video-edit'); assert.equal(movie.inspectionStatus, 'ready'); assert.equal(movie.width, 3840); assert.equal(movie.height, 2160)
        evidence.movieAsset = movie
        const outputRead = await callTool(client, 'read_application_entity', { ref: projectRef })
        const movieResult = await callTool(client, 'collect_video_edit_output', operationEnvelope([outputRead], { projectRef, kind: 'export', taskId: task.data.task.id }))
        assert.equal(movieResult.executionState, 'completed', JSON.stringify(movieResult)); assert.equal(movieResult.verificationState, 'verified', JSON.stringify(movieResult)); assert.equal(movieResult.result.data.resultRef.id, movie.id)
        const library = await page.evaluate(() => window.henjiNative.assetLibrary.createLibrary('剪辑正式输出集合'))
        const libraryRead = await callTool(client, 'read_application_entity', { ref: { kind: 'asset.library', id: library.id } }); const currentRead = await callTool(client, 'read_application_entity', { ref: projectRef })
        await callTool(client, 'collect_video_edit_output', operationEnvelope([currentRead, libraryRead], { projectRef, libraryRef: { kind: 'asset.library', id: library.id }, kind: 'export', taskId: task.data.task.id }))
        const membership = await page.evaluate(id => window.henjiNative.assetLibrary.inspectLibrary(id), library.id); assert.deepEqual(membership.assetIds, [movie.id])
        evidence.publicMovie = movieResult; evidence.library = membership; evidence.phases.push('原4K60实际MP4音画核验，手动与MCP复用同资产及集合')
        evidence.canvas = []
        for (const asset of [selected, movie]) {
          const canvasRef = { kind: 'canvas.project', id: canvasFixtureProjectId }; const assetRef = { kind: 'asset', id: asset.id }
          const reads = await Promise.all([callTool(client, 'read_application_entity', { ref: canvasRef }), callTool(client, 'read_application_entity', { ref: assetRef })])
          const result = await callTool(client, 'add_asset_to_canvas', operationEnvelope(reads, { projectId: canvasFixtureProjectId, assetId: asset.id, placement: { mode: 'absolute', x: 320, y: asset.mediaType === 'image' ? 100 : 500 } }))
          assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result))
          const record = await page.evaluate(id => window.henjiNative.storyboardProjects.getProjectRecord(id), canvasFixtureProjectId)
          const node = JSON.parse(record.nodesJson).find(node => node.id === result.result.data.nodeId); assert.ok(node)
          const stored = asset.mediaType === 'image' ? node.data.imageUrl : node.data.videoUrl
          // The formal project format pools images; assert the persisted pool
          // reference rather than assuming every node stores a literal path.
          const pooled = /^__img_ref__:(\d+)$/.exec(stored)
          const fixedPath = pooled ? JSON.parse(record.historyJson).imagePool[Number(pooled[1])] : stored
          assert.equal(normalized(fixedPath), normalized(asset.filePath))
          evidence.canvas.push({ assetId: asset.id, nodeId: node.id, nodeType: node.type, originalPath: asset.filePath, persisted: true })
        }
        await shot('outputs-movie-collected-original-4k60'); await button(page, '关闭工程').click(); await waitReleased(page)
        for (const original of originals) { const now = fs.statSync(original.file); assert.equal(now.size, original.size); assert.equal(now.mtimeMs, original.mtimeMs) }
        evidence.originalsUnchanged = true; evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0); evidence.completed = true; store()
      } catch (error) { evidence.failed = { message: String(error.message ?? error), stack: error.stack }; store(); await shot('outputs-failed').catch(() => {}); throw error }
      finally {
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭工程').isVisible().catch(() => false)) await button(page, '关闭工程').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.completed = false; evidence.releaseFailure = String(error) }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(previous => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker; if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1'); else if (typeof previous === 'string') localStorage.setItem('henji.videoEdit.dockLayout.v1', previous) }, previousLayout).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditOutputsScene }
