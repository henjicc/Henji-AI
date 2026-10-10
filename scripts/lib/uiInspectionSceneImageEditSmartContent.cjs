/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 场景沿用仓内工厂。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createImageEditSmartContentScene(context) {
  return {
    id: 'image-edit-smart-content', surface: '图片编辑', name: '智能对象内容编辑、共享实例、来源刷新与错误恢复', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    expectedLogEvents: ['image_edit.smart_content.update.failed', 'image_edit.v3.persistence.confirm.failed', 'image_edit.v3.document.autosave.failed', 'canvas.image_edit_v3.persistence.failed'],
    setup: async (page, app, { capture }) => {
      const restorePaid = await blockPaidGeneration(app)
      const host = () => page.locator('[data-image-editor-v3]:visible').last()
      const tab = async id => { await host().locator(`[data-dock-tab="${id}"] > span`).first().click(); await context.settlePage(page, 150) }
      const shoot = async name => {
        await context.settlePage(page, 700)
        const failure = host().getByRole('alert').last()
        const rasterize = host().getByRole('button', { name: '栅格化内容', exact: true })
        if (await failure.count()) await failure.scrollIntoViewIfNeeded()
        else if (await rasterize.count()) await rasterize.scrollIntoViewIfNeeded()
        // 点击后控件卸载时，自动滚动可能残留在宿主外层；只复位外层，保留属性面板滚动。
        await host().evaluate(editor => {
          for (let ancestor = editor.parentElement; ancestor; ancestor = ancestor.parentElement) {
            ancestor.scrollTop = 0; ancestor.scrollLeft = 0
          }
        })
        await context.settlePage(page, 350)
        assert.equal(await host().locator('[data-command-bar]').count(), 1, '工作区只有一条命令带')
        assert.ok(await host().locator('[data-context-bar]').count() <= 1, '工作区上下文带不重复')
        const commandBar = await host().locator('[data-command-bar]').boundingBox()
        const windowHeight = await page.evaluate(() => window.innerHeight)
        assert.ok(commandBar && commandBar.y >= 0 && commandBar.y + commandBar.height <= windowHeight, '命令带完整落在窗口内')
        await capture(name)
      }
      const restoreFault = async () => app.evaluate(({ ipcMain }) => {
        for (const channel of ['imageEditorV3:document:save', 'imageEditorV3:document:load']) {
          const original = globalThis.__smartContentHandlers?.[channel]
          if (original) { ipcMain.removeHandler(channel); ipcMain.handle(channel, original); delete globalThis.__smartContentHandlers[channel] }
        }
      })
      try {
        await host().waitFor({ timeout: 30000 })
        await tab('properties')
        await host().getByRole('button', { name: '转换为智能对象', exact: true }).click()
        await host().getByRole('button', { name: '打开内容', exact: true }).waitFor()
        await shoot('embedded-source-empty')
        const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
        const smart = loadTypeScript('src/core/imageEdit/v3/smartContent/commands.ts')
        const parent = factory.createImageEditDocumentV3({ width: 512, height: 384, documentId: 'reality-smart-content' })
        parent.layers = [factory.createImageEditRasterLayerV3('content', '智能对象底图')]
        const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
        const nodeId = 'smart-content-node'
        const seeded = await page.evaluate(async ({ parent, projectId, nodeId, filePath }) => {
          const api = window.henjiNative.imageEditorV3
          const managed = await api.ingestSource({ requestId: `smart-ingest-${crypto.randomUUID()}`, source: { kind: 'local-path', filePath } })
          parent.geometry.width = managed.metadata.width; parent.geometry.height = managed.metadata.height
          parent.layers[0].source = { kind: 'resource', resourceId: managed.resource.resourceRef }
          const saved = await api.saveDocument({ requestId: `smart-parent-${crypto.randomUUID()}`, document: parent, expectedRevision: 0, history: null, resourceRefs: [managed.resource.resourceRef], previewRef: null })
          const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
          canvas.nodes.push({ id: nodeId, type: 'layerStackResultNode', position: { x: 520, y: 80 }, data: { displayName: '智能对象验收', resultKind: 'layer-stack', isGenerating: false,
            imageUrl: managed.mediaUrl, previewImageUrl: managed.mediaUrl, aspectRatio: '4:3', imageEditSession: { kind: 'image-edit-v3', sourceUrl: managed.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: null } } })
          await window.henjiNative.testFixtures.writeCanvas(projectId, { ...canvas, viewport: { x: 80, y: 100, zoom: .65 } })
          return { parent, resource: managed.resource.resourceRef, documentRef: saved.documentRef }
        }, { parent, projectId, nodeId, filePath: path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png') })
        const source = structuredClone(seeded.parent); source.id = 'reality-smart-source'; source.layers[0].name = '受管理内容'
        const cyclic = structuredClone(source); cyclic.id = 'reality-smart-cycle'; cyclic.layers[0] = smart.embedImageEditRasterV3(cyclic, cyclic.layers[0].id)
        cyclic.layers[0].content.origin = { kind: 'image_edit.document', id: parent.id }
        const missing = structuredClone(source); missing.id = 'reality-smart-missing'
        const sourceNames = await page.evaluate(async ({ documents, resource }) => {
          const names = []
          for (const document of documents) {
            const api = window.henjiNative.imageEditorV3
            await api.saveDocument({ requestId: `smart-source-${crypto.randomUUID()}`, document, expectedRevision: 0, history: null, resourceRefs: [resource], previewRef: null })
            const ready = await api.createImageDocument({ requestId: `smart-source-file-${crypto.randomUUID()}`, documentId: document.id, container: { kind: 'user' }, emptyUntilRevision: null })
            names.push(ready.read.meta.name)
          }
          return names
        }, { documents: [source, cyclic, missing], resource: seeded.resource })
        await context.reopenCanvasProjectFromStorage(page, projectId)
        const open = async () => { await page.locator(`[data-layer-stack-node-id="${nodeId}"]`).getByRole('button', { name: /^(编辑|Edit)$/i }).click(); await host().waitFor({ timeout: 30000 }); await tab('layers') }
        await open()
        await host().locator('[data-layer-id="content"] [data-layer-select]').click(); await tab('properties')
        await shoot('raster-before-conversion')
        await host().getByRole('button', { name: '转换为智能对象', exact: true }).click()
        await host().getByRole('button', { name: '打开内容', exact: true }).waitFor()
        await shoot('embedded-object-properties')
        await tab('layers'); await host().getByRole('button', { name: '复制图层', exact: true }).click(); await tab('properties')
        await host().getByRole('button', { name: '打开内容', exact: true }).click()
        await page.locator('[data-smart-content-editor]:visible').waitFor(); await shoot('nested-content-open')
        await tab('properties'); await host().getByRole('tab', { name: '基础', exact: true }).click()
        const name = host().getByRole('textbox', { name: '名称', exact: true }); await name.fill('已编辑的智能内容'); await name.press('Enter')
        await app.evaluate(({ ipcMain }) => {
          const channel = 'imageEditorV3:document:save'; globalThis.__smartContentHandlers ??= {}; globalThis.__smartContentHandlers[channel] = ipcMain._invokeHandlers.get(channel)
          ipcMain.removeHandler(channel); ipcMain.handle(channel, () => ({ ok: false, error: { name: 'Error', code: 'ENOSPC', message: '磁盘空间不足，请清理空间后重试保存' } }))
        })
        await page.getByRole('button', { name: '应用内容并返回', exact: true }).click()
        try { await page.getByRole('button', { name: '重试保存并返回', exact: true }).waitFor({ timeout: 30000 }) }
        catch (error) { await shoot('content-apply-failed'); throw new Error(`${error.message}\n${await page.locator('[data-smart-content-editor]').innerText()}`) }
        await shoot('nested-save-failed-content-retained')
        await restoreFault()
        await page.getByRole('button', { name: '重试保存并返回', exact: true }).click()
        await page.locator('[data-smart-content-editor]').waitFor({ state: 'hidden', timeout: 30000 }); await tab('properties')
        await shoot('shared-content-applied-and-returned')
        await host().getByRole('button', { name: '关闭属性面板', exact: true }).click()
        await shoot('smart-properties-closed')
        await host().getByRole('button', { name: '面板', exact: true }).click()
        await page.getByRole('menuitem', { name: '显示属性面板', exact: true }).click()
        await tab('properties'); await shoot('smart-properties-reopened')
        const chooseSource = async label => { await host().getByRole('button', { name: '选择图片文档来源', exact: true }).click(); await page.getByRole('option', { name: label, exact: true }).click() }
        await chooseSource(sourceNames[0]); await host().getByRole('button', { name: '从来源刷新', exact: true }).waitFor(); await shoot('managed-source-refreshed')
        await chooseSource(sourceNames[1]); await host().getByText('智能对象来源不能指向当前文档或它的上级内容', { exact: true }).waitFor({ timeout: 30000 }); await shoot('cycle-source-rejected')
        await app.evaluate(({ ipcMain }) => {
          const channel = 'imageEditorV3:document:load'; globalThis.__smartContentHandlers ??= {}; globalThis.__smartContentHandlers[channel] = ipcMain._invokeHandlers.get(channel)
          const handler = globalThis.__smartContentHandlers[channel]; ipcMain.removeHandler(channel)
          ipcMain.handle(channel, (event, payload) => payload.documentRef === 'image-edit-v3:reality-smart-missing'
            ? { ok: false, error: { name: 'Error', code: 'ENOENT', message: '来源内容资源缺失，请重新定位来源后重试' } } : handler(event, payload))
        })
        await chooseSource(sourceNames[2]); await host().getByText(/来源内容资源缺失/, { exact: false }).waitFor({ timeout: 30000 }); await shoot('source-missing-keeps-current-content')
        await restoreFault()
        await host().getByRole('button', { name: '从来源刷新', exact: true }).click(); await context.settlePage(page, 900)
        await host().getByRole('button', { name: '栅格化内容', exact: true }).click(); await host().getByRole('button', { name: '转换为智能对象', exact: true }).waitFor(); await shoot('rasterized-content')
        await host().getByRole('button', { name: '撤销', exact: true }).first().click(); await host().getByRole('button', { name: '打开内容', exact: true }).waitFor(); await shoot('undo-restores-editable-content')
        await page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i }).getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
        await open(); await host().locator('[data-layer-id="content"] [data-layer-select]').click(); await tab('properties'); await shoot('document-reopened-smart-content')
        const persisted = await page.evaluate(documentRef => window.henjiNative.imageEditorV3.loadDocument({ requestId: `smart-final-${crypto.randomUUID()}`, documentRef }), seeded.documentRef)
        const instances = persisted.document.layers.filter(layer => layer.type === 'smart')
        assert.equal(instances.length, 2); assert.equal(instances[0].content.id, instances[1].content.id)
        assert.deepEqual(instances[0].content, instances[1].content)
      } finally { await restoreFault(); await restorePaid() }
    },
  }
}
module.exports = { createImageEditSmartContentScene }
