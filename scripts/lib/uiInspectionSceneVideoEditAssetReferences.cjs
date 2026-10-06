const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, operationEnvelope } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, saved, presented, png, pixelDifference, trackBanks } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { adoptNewVideoEditProject, leaveVideoEditProject, openVideoEditFile, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

const button = (page, name) => page.getByRole('button', { name, exact: true })
const entry = (page, id) => page.locator(`[data-video-edit-project-entry="${id}"]`)
const normalized = value => value.replaceAll('/', '\\').toLowerCase()
async function sourceReady(page) {
  await page.waitForFunction(() => document.querySelector('[data-video-edit-source-status]')?.dataset.videoEditSourceStatus === 'ready'
    && document.querySelector('[data-video-edit-source-media="image"]')?.naturalWidth === 3840, undefined, { timeout: 30000 })
}

/** Real dragging keeps the stale card payload; the domain must resolve its asset ID. */
function createVideoEditAssetReferencesScene() {
  return { id: 'video-edit-asset-references', surface: '剪辑', name: '剪辑-可信资产拖入固定原路径保存重开与重新定位', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-asset-references'); fs.mkdirSync(root, { recursive: true })
      const file = path.join(root, 'fixed-reference.henji-video'); const first = path.join(root, 'first-original.png'); const second = path.join(root, 'second-original.png')
      for (const [target, color] of [[first, { r: 21, g: 80, b: 220 }], [second, { r: 35, g: 195, b: 87 }]]) {
        if (!fs.existsSync(target)) await sharp({ create: { width: 3840, height: 2160, channels: 3, background: color } }).png().toFile(target)
      }
      const fixture = readVideoEditFile(path.resolve('node_modules/.cache/video-edit-monitor/monitor.henji-video'))
      fixture.id = 'asset-fixed-reference'; fixture.name = '固定原路径资产引用'; fixture.revision = 0
      fixture.media = []; fixture.bins = []; fixture.items = []; fixture.codeMaterials = []; fixture.sequences = [fixture.sequences[0]]
      const sequence = fixture.sequences[0]
      sequence.clips = []; sequence.captions = []; sequence.markers = []; sequence.transitions = []; sequence.annotations = []
      assert.equal(sequence.width, 3840); assert.equal(sequence.height, 2160); assert.deepEqual(sequence.frameRate, { numerator: 60, denominator: 1 })
      fs.writeFileSync(file, JSON.stringify(fixture))
      const originals = [first, second].map(file => ({ file, size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs }))
      const evidence = { completed: false, phases: [], captures: [], originals }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      let client; let previousLayout; let observed = false
      try {
        evidence.display = await app.evaluate(({ BrowserWindow, screen }, { point, hostContentsId }) => {
          const host = (BrowserWindow.getAllWindows().find(window => window.webContents.id === hostContentsId) ?? BrowserWindow.getAllWindows()[0])
          const bounds = host.getBounds(); const current = screen.getDisplayMatching(bounds); const coordinates = point?.split(',').map(Number)
          const selected = coordinates ? screen.getAllDisplays().find(display => coordinates[0] >= display.bounds.x && coordinates[0] < display.bounds.x + display.bounds.width && coordinates[1] >= display.bounds.y && coordinates[1] < display.bounds.y + display.bounds.height) : undefined
          return { windowBounds: bounds, id: current.id, primary: current.id === screen.getPrimaryDisplay().id, bounds: current.bounds, preferredId: selected?.id }
        }, { point: process.env.HENJI_DEV_DISPLAY_POINT, hostContentsId: await (await app.browserWindow(page)).evaluate((window) => window.webContents.id) })
        if (process.env.HENJI_DEV_DISPLAY_POINT) { assert.ok(evidence.display.preferredId !== undefined); assert.equal(evidence.display.id, evidence.display.preferredId); assert.equal(evidence.display.primary, false) }
        await button(page, '剪辑').click()
        if (await button(page, '关闭项目').isVisible()) await button(page, '关闭项目').click()
        await button(page, '生成').click()
        previousLayout = await page.evaluate(() => localStorage.getItem('henji.videoEdit.dockLayout.v1'))
        await page.evaluate(() => localStorage.removeItem('henji.videoEdit.dockLayout.v1'))
        await observeWorkers(page); observed = true; await button(page, '剪辑').click()
        const open = async () => { await dialogs(app, [file], file); await openVideoEditFile(page, file); await button(page, '关闭项目').waitFor({ state: 'visible' }) }
        await open()
        phase('原生资产核验与陈旧卡片路径的真实拖入')
        const asset = await page.evaluate(async filePath => {
          const created = await window.henjiNative.assetLibrary.createAsset({ filePath, mediaType: 'image', source: 'external', displayName: '可信资产原图' })
          return window.henjiNative.assetLibrary.inspectAsset(created.id)
        }, first)
        assert.equal(asset.inspectionStatus, 'ready'); assert.match(asset.contentIdentity, /^[a-f0-9]{64}$/)
        await button(page, '资产库').click()
        const card = page.locator('[data-asset-card]').filter({ hasText: '可信资产原图' }); await card.waitFor({ state: 'visible', timeout: 10000 })
        const relocated = await page.evaluate(async ({ id, filePath }) => {
          await window.henjiNative.assetLibrary.relocateAsset(id, filePath)
          return window.henjiNative.assetLibrary.inspectAsset(id)
        }, { id: asset.id, filePath: second })
        assert.equal(relocated.inspectionStatus, 'ready'); assert.notEqual(relocated.contentIdentity, asset.contentIdentity)
        const list = page.getByLabel('项目项列表', { exact: true }); const rectangle = await list.boundingBox(); assert.ok(rectangle)
        const dragStart = performance.now(); await card.dragTo(list, { targetPosition: { x: 12, y: rectangle.height - 30 } })
        let document = await saved(page, file, value => value.media.length === 1 && value.items.length === 1)
        evidence.dragImportMs = performance.now() - dragStart
        const media = document.media[0]; const item = document.items[0]
        assert.equal(normalized(media.path), normalized(second)); assert.equal(media.assetId, asset.id); assert.equal(media.assetContent.contentIdentity, relocated.contentIdentity)
        assert.equal(media.width, 3840); assert.equal(media.height, 2160); assert.equal(document.sequences[0].clips.length, 0)
        await list.click({ position: { x: 12, y: rectangle.height - 30 } }); await page.locator('[data-asset-floating-panel]').waitFor({ state: 'hidden' })
        await entry(page, item.id).click({ button: 'right' }); await page.getByRole('menuitem', { name: '添加到当前序列', exact: true }).click()
        document = await saved(page, file, value => value.sequences[0].clips.length === 1); await presented(page, 0)
        await page.waitForFunction(revision => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedRevision === String(revision), document.revision)
        evidence.program = await png(page, path.join(root, 'program-original.png')); evidence.trackBanks = await trackBanks(page)
        const center = await sharp(evidence.program.file).extract({ left: 1920, top: 1080, width: 1, height: 1 }).removeAlpha().raw().toBuffer()
        for (const [index, value] of [35, 195, 87].entries()) assert.ok(Math.abs(center[index] - value) <= 1, `真实出画必须使用当前资产原路径：${center}`)
        await entry(page, item.id).dblclick(); await sourceReady(page)
        await shot('asset-trusted-drag-original-4k-source-and-program')
        evidence.phases.push('真实陈旧卡片拖入按ID读取当前路径、源与节目出画')
        phase('同源公共MCP导入及固定资产内容保存')
        const identity = await authorizeMcpConnection(page, { name: '可信资产引用验收', allowWrites: true })
        client = await connectMcpClient(identity.config, 'Henji asset reference Reality')
        const projectRef = { kind: 'video_edit.document', id: fixture.id }
        const baseline = await callTool(client, 'read_application_entity', { ref: projectRef })
        const result = await callTool(client, 'import_video_edit_asset', operationEnvelope([baseline], { documentRef: projectRef, assetRef: { kind: 'asset', id: asset.id } }))
        assert.equal(result.executionState, 'completed', JSON.stringify(result)); assert.equal(result.verificationState, 'verified', JSON.stringify(result))
        document = await saved(page, file, value => value.media.length === 1 && value.items.length === 1)
        assert.equal(document.sequences[0].clips.length, 1); assert.equal(document.media[0].sourceRevision, media.sourceRevision)
        evidence.publicImport = { executionState: result.executionState, verificationState: result.verificationState, mediaId: media.id, duplicateMedia: 0, duplicateItems: 0 }
        evidence.phases.push('现代MCP复用相同领域导入且不重复注册')
        phase('删除资产库记录后的固定原路径保存重开与显式重新定位')
        await page.evaluate(id => window.henjiNative.assetLibrary.deleteAsset(id), asset.id)
        await button(page, '关闭项目').click(); await waitReleased(page)
        await open(); await presented(page, 0)
        evidence.reopened = await png(page, path.join(root, 'program-reopened.png')); evidence.reopenDifference = await pixelDifference(evidence.program.file, evidence.reopened.file)
        assert.ok(evidence.reopenDifference.equal)
        await entry(page, item.id).dblclick(); await sourceReady(page)
        await dialogs(app, [second], file); await entry(page, item.id).click({ button: 'right' }); await page.getByRole('menuitem', { name: '重新定位源文件', exact: true }).click()
        document = await saved(page, file, value => value.media[0].sourceRevision !== media.sourceRevision)
        assert.equal(document.media[0].id, media.id); assert.equal(document.media[0].assetId, asset.id); assert.equal(document.media[0].assetContent.contentIdentity, relocated.contentIdentity)
        await presented(page, 0)
        await page.waitForFunction(revision => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedRevision === String(revision), document.revision)
        const relinked = await png(page, path.join(root, 'program-relinked.png')); evidence.relinkDifference = await pixelDifference(evidence.program.file, relinked.file); assert.ok(evidence.relinkDifference.equal)
        await entry(page, item.id).dblclick(); await sourceReady(page)
        evidence.fixedReference = { deletedLibraryRecord: true, mediaId: media.id, assetId: asset.id, path: document.media[0].path, sourceRevision: document.media[0].sourceRevision, contentIdentity: document.media[0].assetContent.contentIdentity }
        await shot('asset-deleted-library-fixed-path-reopen-and-relink')
        evidence.phases.push('记录删除后原路径仍可出画、重开、显式重新定位')
        await button(page, '关闭项目').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0); assert.equal(await page.locator('[data-video-edit-source-media]').count(), 0)
        for (const original of originals) { const now = fs.statSync(original.file); assert.equal(now.size, original.size); assert.equal(now.mtimeMs, original.mtimeMs) }
        evidence.originalsUnchanged = true; evidence.completed = true; delete evidence.currentPhase; store()
      } catch (error) {
        evidence.failed = { message: String(error.message ?? error), stack: error.stack }; store(); await shot('asset-references-failed').catch(() => {}); throw error
      } finally {
        await page.mouse.up().catch(() => {}); await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.releaseFailure = String(error); evidence.completed = false }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(previous => {
          window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker
          if (previous === null) localStorage.removeItem('henji.videoEdit.dockLayout.v1'); else if (typeof previous === 'string') localStorage.setItem('henji.videoEdit.dockLayout.v1', previous)
        }, previousLayout).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditAssetReferencesScene }
