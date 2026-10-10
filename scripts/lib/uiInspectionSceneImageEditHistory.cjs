/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 场景采用仓内 CommonJS 工厂。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp } = require('./uiInspectionMcpClient.cjs')

function createImageEditHistoryScene(context) {
  return {
    id: 'image-edit-history', surface: '图片编辑', name: '统一历史-长列表、跳转、取消和重新打开', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    expectedLogEvents: ['image_edit.history.jump.failed', 'canvas.image_edit_v3.persistence.failed',
      'image_edit.v3.document.autosave.failed', 'image_edit.v3.persistence.confirm.failed'],
    setup: async (page, app, { capture }) => {
      const restorePaid = await blockPaidGeneration(app)
      let client = null
      const host = () => page.locator('[data-image-editor-v3]:visible').last()
      const showHistory = async () => {
        const tab = host().locator('[data-dock-tab="history"] > span').first()
        if (await tab.count()) await tab.click()
        else {
          await host().getByRole('button', { name: '面板', exact: true }).click()
          await page.getByRole('menuitem', { name: '显示历史面板', exact: true }).click()
        }
        await host().locator('[data-image-history-panel]').waitFor({ state: 'visible' })
      }
      const shoot = async label => {
        assert.equal(await host().locator('[data-command-bar]').count(), 1)
        assert.ok(await host().locator('[data-context-bar]').count() <= 1)
        if (['selection-window-reopened', 'selection-persisted-reopened', 'panel-reopened', 'document-reopened'].includes(label)) {
          await host().locator('[data-image-history-row] [aria-current="step"]').waitFor({ state: 'visible' })
          await page.waitForFunction(() => document.querySelectorAll('[data-image-history-panel] img').length >= 3, undefined, { timeout: 30000 })
        }
        await context.settlePage(page, 200)
        await capture(label)
      }
      const restoreTimers = () => page.evaluate(() => {
        if (window.__historyOriginalTimeout) { window.setTimeout = window.__historyOriginalTimeout; delete window.__historyOriginalTimeout }
      })
      try {
        await host().waitFor({ state: 'visible', timeout: 30000 })
        await showHistory()
        await host().getByText('还没有编辑记录', { exact: true }).waitFor()
        await shoot('empty')
        const { createImageEditDocumentV3, createImageEditRasterLayerV3 } = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
        const { ImageEditCommandHistoryV3 } = loadTypeScript('src/core/imageEdit/v3/commandHistory.ts')
        let document = createImageEditDocumentV3({ width: 512, height: 384, documentId: 'reality-image-history' })
        document.layers = [createImageEditRasterLayerV3('source', '底图')]
        const history = new ImageEditCommandHistoryV3()
        for (let index = 0; index < 270; index++) document = history.execute(document, {
          type: 'layer.update-common', layerId: 'source', commandId: `history-name-${index}`,
          expectedRevision: document.revision, patch: { name: `图层命名 ${index + 1}` },
        })
        const snapshot = history.createSnapshot()
        const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
        const nodeId = '__ui_image_history'
        const documentRef = await page.evaluate(async ({ projectId, nodeId, document, history, filePath }) => {
          const managed = await window.henjiNative.imageEditorV3.ingestSource({ requestId: `history-ingest-${crypto.randomUUID()}`, source: { kind: 'local-path', filePath } })
          document.geometry.width = managed.metadata.width; document.geometry.height = managed.metadata.height
          document.layers[0].source = { kind: 'resource', resourceId: managed.resource.resourceRef }
          const saved = await window.henjiNative.imageEditorV3.saveDocument({ requestId: `history-save-${crypto.randomUUID()}`,
            document, expectedRevision: 0, history, resourceRefs: [managed.resource.resourceRef], previewRef: null })
          const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
          canvas.nodes.push({ id: nodeId, type: 'layerStackResultNode', position: { x: 520, y: 80 }, data: {
            displayName: '历史验收图片', resultKind: 'layer-stack', isGenerating: false,
            imageUrl: managed.mediaUrl, previewImageUrl: managed.mediaUrl, aspectRatio: '4:3',
            imageEditSession: { kind: 'image-edit-v3', sourceUrl: managed.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: null },
          } })
          await window.henjiNative.testFixtures.writeCanvas(projectId, { ...canvas, viewport: { x: 80, y: 100, zoom: .65 } })
          return saved.documentRef
        }, { projectId, nodeId, document, history: snapshot, filePath: path.resolve(__dirname, '../../tests/fixtures/image-inpainting/face-scratch-source.png') })
        await context.reopenCanvasProjectFromStorage(page, projectId)
        const open = async () => {
          await page.locator(`[data-layer-stack-node-id="${nodeId}"]`).getByRole('button', { name: /^(编辑|Edit)$/i }).click()
          await host().waitFor({ state: 'visible', timeout: 30000 })
          await showHistory()
        }
        await open()
        const identity = await authorizeMcpConnection(page, { name: '图片历史截图只读' })
        client = await connectMcpClient(identity.config, '图片历史截图只读')
        const ref = { kind: 'image_edit.document', id: 'v3:reality-image-history' }
        const read = async () => (await callTool(client, 'read_application_entity', { ref, propertyIds: ['image_edit.document.history_position', 'image_edit.document.history_length'] })).data.properties
        assert.equal((await read())['image_edit.document.history_length'], 270)
        await host().locator('[data-image-history-row="270"]').waitFor()
        await page.waitForFunction(() => document.querySelectorAll('[data-image-history-panel] img').length >= 3, undefined, { timeout: 30000 })
        assert.ok(await host().locator('[data-image-history-row]').count() < 100, '历史列表必须虚拟化')
        await shoot('long-current')
        await host().locator('[data-tool-id="select-rect"]').click()
        await page.getByRole('menuitem', { name: '矩形选择', exact: true }).click()
        const selection = host().locator('[data-tool-overlay-slot="selection"] svg')
        await selection.waitFor({ state: 'visible' })
        const bounds = await selection.boundingBox()
        assert.ok(bounds)
        await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .4)
        await page.mouse.down()
        await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .6, { steps: 8 })
        await page.mouse.up()
        await host().locator('[data-image-history-row="271"]').waitFor()
        assert.equal((await read())['image_edit.document.history_length'], 271)
        await shoot('selection-transient')
        await page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i }).getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
        await open()
        assert.equal((await read())['image_edit.document.history_length'], 271, '窗口重开应继续使用同一应用内实例')
        await shoot('selection-window-reopened')
        const persistedHistory = await page.evaluate(async documentRef => {
          const loaded = await window.henjiNative.imageEditorV3.loadDocument({ requestId: `history-check-${crypto.randomUUID()}`, documentRef })
          return loaded.history
        }, documentRef)
        assert.equal(persistedHistory.cold.prefixLength, 270, '磁盘历史不包含瞬态选区')
        assert.equal(persistedHistory.undo.length + persistedHistory.redo.length, 0, '重开只返回冷页索引，不全量恢复命令')
        await page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i }).getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
        await page.reload({ waitUntil: 'domcontentloaded' })
        await context.reopenCanvasProjectFromStorage(page, projectId)
        await open()
        assert.equal((await read())['image_edit.document.history_length'], 270, '重新加载持久文档不包含会话选区')
        await shoot('selection-persisted-reopened')
        await host().locator('[data-image-history-panel]').getByRole('button', { name: '撤销', exact: true }).click()
        await host().locator('[data-image-history-row="269"] [aria-current="step"]').waitFor()
        await shoot('undo')
        await host().locator('[data-image-history-panel]').getByRole('button', { name: '重做', exact: true }).click()
        await host().locator('[data-image-history-row="270"] [aria-current="step"]').waitFor()
        const start = async () => {
          // Virtuoso 在行测量变化后重试定位，内部清理窗口为 1200ms；结束后再模拟用户滚动。
          await context.settlePage(page, 1500)
          await host().locator('[data-testid="virtuoso-scroller"]').evaluate(element => { element.scrollTop = 0 })
          await host().locator('[data-image-history-row="0"]').waitFor()
          await host().locator('[data-image-history-row="0"] button').click()
        }
        // 调度故障夹具只延长让出线程的等待，正式求值与取消路径保持原实现。
        await page.evaluate(() => {
          window.__historyOriginalTimeout = window.setTimeout
          window.setTimeout = function (callback, delay, ...args) {
            // Promise resolver 是原生函数；不要同时拖慢 Virtuoso 的行测量/滚动回调。
            const yielding = delay === 0 && typeof callback === 'function'
              && Function.prototype.toString.call(callback).includes('[native code]')
            return window.__historyOriginalTimeout(callback, yielding ? 100 : delay, ...args)
          }
        })
        await start()
        await host().getByRole('button', { name: '取消恢复', exact: true }).waitFor()
        await shoot('jump-progress')
        await host().getByRole('button', { name: '取消恢复', exact: true }).click()
        await restoreTimers()
        await host().getByRole('button', { name: '取消恢复', exact: true }).waitFor({ state: 'hidden' })
        assert.equal((await read())['image_edit.document.history_position'], 270)
        await shoot('cancelled')
        await start()
        await host().locator('[data-image-history-row="0"] [aria-current="step"]').waitFor()
        await shoot('jump-initial')
        await host().getByRole('button', { name: '回到最新', exact: true }).click()
        await host().locator('[data-image-history-row="270"] [aria-current="step"]').waitFor()
        await host().getByRole('button', { name: '关闭历史面板', exact: true }).click()
        await showHistory()
        await shoot('panel-reopened')
        // 磁盘不足通过同一正式 IPC 的结构化失败注入，保存 owner/脏状态/重试仍走生产路径。
        await app.evaluate(({ ipcMain }) => {
          const channel = 'imageEditorV3:document:save'
          globalThis.__historySaveHandler = ipcMain._invokeHandlers.get(channel)
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, () => ({ ok: false, error: { name: 'Error', code: 'ENOSPC', message: '磁盘空间不足，请清理空间后重试保存' } }))
        })
        await host().locator('[data-image-history-panel]').getByRole('button', { name: '撤销', exact: true }).click()
        await host().getByRole('button', { name: '保存失败，重试', exact: true }).waitFor({ timeout: 30000 })
        await shoot('disk-failed')
        await app.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('imageEditorV3:document:save')
          ipcMain.handle('imageEditorV3:document:save', globalThis.__historySaveHandler)
          delete globalThis.__historySaveHandler
        })
        await host().getByRole('button', { name: '保存失败，重试', exact: true }).click()
        await host().getByRole('button', { name: '保存失败，重试', exact: true }).waitFor({ state: 'hidden' })
        assert.equal((await read())['image_edit.document.history_position'], 269)
        await shoot('disk-recovered')
        await page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i }).getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
        await page.reload({ waitUntil: 'domcontentloaded' })
        await context.reopenCanvasProjectFromStorage(page, projectId)
        await open()
        assert.equal((await read())['image_edit.document.history_length'], 270)
        assert.equal((await read())['image_edit.document.history_position'], 269)
        await shoot('document-reopened')
      } finally {
        await restoreTimers()
        await app.evaluate(({ ipcMain }) => {
          if (globalThis.__historySaveHandler) { ipcMain.removeHandler('imageEditorV3:document:save'); ipcMain.handle('imageEditorV3:document:save', globalThis.__historySaveHandler); delete globalThis.__historySaveHandler }
        })
        if (client) await client.close()
        await disableMcp(page)
        await restorePaid()
      }
    },
  }
}
module.exports = { createImageEditHistoryScene }
