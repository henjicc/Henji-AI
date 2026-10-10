/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检沿现有 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

function createImageEditRetouchScene(context) {
  return {
    id: 'image-edit-retouch', surface: '图片编辑', name: '连续修饰-供体叠加、对齐、修复和内容识别确认', writesUserData: true,
    expectedLogEvents: ['image_edit.repair.failed'],
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/brick-large-source.png'],
    setup: async (page, app, { capture }) => {
      const restore = await blockPaidGeneration(app)
      const host = page.locator('[data-image-editor-v3]:visible').last()
      const shoot = async name => {
        await context.settlePage(page, 600)
        assert.equal(await host.locator('[data-command-bar]').count(), 1)
        assert.ok(await host.locator('[data-context-bar]').count() <= 1)
        assert.equal(await page.getByText(/concurrency limit reached|画笔瓦片未写入/).count(), 0, '正常手势不能出现读取并发失败')
        await capture(name)
      }
      const choose = async name => {
        await host.getByRole('button', { name: '修饰', exact: true }).click()
        await page.getByRole('menuitem', { name, exact: true }).click()
      }
      const revision = async () => Number(await host.locator('[data-command-bar]').getAttribute('data-document-revision'))
      const area = () => host.locator('[data-raster-brush-overlay]')
      const move = async point => { const box = await area().boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width * point[0], box.y + box.height * point[1]) }
      const pick = async point => {
        const box = await area().boundingBox(); assert.ok(box)
        await page.keyboard.down('Alt')
        try { await page.mouse.click(box.x + box.width * point[0], box.y + box.height * point[1]) } finally { await page.keyboard.up('Alt') }
      }
      const draw = async (from, to, cancelled = false) => {
        const before = await revision(); await move(from); await page.mouse.down(); await move(to)
        if (cancelled) await page.keyboard.press('Escape')
        await page.mouse.up()
        if (cancelled) { await context.settlePage(page, 300); assert.equal(await revision(), before) }
        else await page.waitForFunction(value => Number(Array.from(document.querySelectorAll('[data-image-editor-v3] [data-command-bar]')).filter(element => element.checkVisibility()).at(-1)?.getAttribute('data-document-revision')) === value + 1, before, { timeout: 30000 })
      }
      try {
        await host.waitFor({ timeout: 30000 }); await choose('仿制图章')
        await shoot('clone-no-source')
        await area().click()
        await host.getByText('请先 Alt 点击干净来源，或点取样后在画面中选择来源', { exact: true }).waitFor()
        await shoot('clone-source-required')
        const size = host.getByRole('spinbutton', { name: '大小', exact: true }); await size.fill('40'); await size.press('Enter')
        await pick([.18, .18]); await move([.55, .46]); await host.locator('[data-retouch-donor-preview]').waitFor()
        await shoot('donor-overlay-aligned')
        await draw([.55, .46], [.65, .46]); await shoot('clone-aligned-first')
        await draw([.55, .54], [.65, .54]); await shoot('clone-aligned-next')
        await host.getByRole('switch', { name: '对齐供体', exact: true }).click()
        await draw([.35, .65], [.45, .65]); await shoot('clone-unaligned')
        await host.getByRole('button', { name: '撤销', exact: true }).click(); await shoot('clone-one-undo')
        await draw([.2, .75], [.7, .75], true); await shoot('stroke-cancelled')
        await choose('修复画笔'); await pick([.15, .4]); await draw([.55, .38], [.65, .38]); await shoot('healing-boundary')
        await host.getByRole('switch', { name: '显示来源', exact: true }).click(); await shoot('source-overlay-hidden')
        // Restore original pixels so the texture result is compared on the fixed damaged fixture.
        for (let i = 0; i < 3; i++) await host.getByRole('button', { name: '撤销', exact: true }).click()
        await host.locator('[data-tool-id^="select-"]').click(); await page.getByRole('menuitem', { name: '矩形选择', exact: true }).click()
        const selection = host.locator('[data-tool-overlay-slot="selection"] svg'), box = await selection.boundingBox(); assert.ok(box)
        await page.mouse.move(box.x + box.width * .32, box.y + box.height * .28); await page.mouse.down()
        await page.mouse.move(box.x + box.width * .67, box.y + box.height * .75, { steps: 8 }); await page.mouse.up()
        await choose('内容识别填充'); await shoot('fill-selection-ready')
        const preview = async () => { await host.getByRole('button', { name: '预览填充', exact: true }).click(); await host.getByRole('button', { name: '应用', exact: true }).waitFor({ timeout: 30000 }) }
        const before = await revision(); await preview(); assert.equal(await revision(), before); await shoot('texture-preview')
        await host.getByRole('button', { name: '取消处理', exact: true }).click(); await shoot('texture-preview-cancelled'); assert.equal(await revision(), before)
        await preview(); await host.getByRole('button', { name: '应用', exact: true }).click()
        await page.waitForFunction(value => Number(Array.from(document.querySelectorAll('[data-image-editor-v3] [data-command-bar]')).filter(element => element.checkVisibility()).at(-1)?.getAttribute('data-document-revision')) === value + 1, before)
        await shoot('texture-applied')
        await host.getByRole('button', { name: '撤销', exact: true }).click(); await shoot('texture-one-undo')
        await page.evaluate(() => {
          window.__retouchPostMessage = Worker.prototype.postMessage
          Worker.prototype.postMessage = function (message, ...rest) {
            if (message.type === 'texture') { queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: { error: '纹理计算失败，请重新尝试' } }))); return }
            return window.__retouchPostMessage.call(this, message, ...rest)
          }
        })
        try {
          await host.getByRole('button', { name: '预览填充', exact: true }).click()
          await host.getByText('纹理计算失败，请重新尝试', { exact: true }).waitFor(); await shoot('texture-failed-recoverable')
        } finally { await page.evaluate(() => { Worker.prototype.postMessage = window.__retouchPostMessage; delete window.__retouchPostMessage }) }
        await preview(); await shoot('texture-recovered'); await host.getByRole('button', { name: '取消处理', exact: true }).click()
        await preview(); await host.getByRole('button', { name: '应用', exact: true }).click()
        await host.locator('[data-tool-id^="select-"]').click(); await page.getByRole('menuitem', { name: '矩形选择', exact: true }).click()
        await host.getByRole('button', { name: '取消选区', exact: true }).click(); await shoot('texture-applied-clean')
        await choose('内容识别填充'); assert.equal(await host.getByRole('button', { name: '预览填充', exact: true }).isDisabled(), true); await shoot('fill-no-selection')
        const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
        const document = factory.createImageEditDocumentV3({ width: 512, height: 512, documentId: 'reality-retouch-canvas' })
        document.layers = [factory.createImageEditRasterLayerV3('base', '连续修饰底图')]
        const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page), nodeId = '__ui_retouch_canvas'
        await page.evaluate(async ({ document, projectId, nodeId, filePath }) => {
          const managed = await window.henjiNative.imageEditorV3.ingestSource({ requestId: `retouch-ingest-${crypto.randomUUID()}`, source: { kind: 'local-path', filePath } })
          document.layers[0].source = { kind: 'resource', resourceId: managed.resource.resourceRef }
          const saved = await window.henjiNative.imageEditorV3.saveDocument({ requestId: `retouch-save-${crypto.randomUUID()}`, document, expectedRevision: 0, history: null, resourceRefs: [managed.resource.resourceRef], previewRef: null })
          const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
          canvas.nodes.push({ id: nodeId, type: 'layerStackResultNode', position: { x: 520, y: 80 }, data: { displayName: '连续修饰验收', resultKind: 'layer-stack', isGenerating: false,
            imageUrl: managed.mediaUrl, previewImageUrl: managed.mediaUrl, aspectRatio: '1:1', imageEditSession: { kind: 'image-edit-v3', sourceUrl: managed.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: null } } })
          await window.henjiNative.testFixtures.writeCanvas(projectId, { ...canvas, viewport: { x: 80, y: 100, zoom: .65 } })
        }, { document, projectId, nodeId, filePath: path.resolve('tests/fixtures/image-inpainting/brick-large-source.png') })
        await context.reopenCanvasProjectFromStorage(page, projectId)
        await page.locator(`[data-layer-stack-node-id="${nodeId}"]`).getByRole('button', { name: /^(编辑|Edit)$/i }).click()
        await host.waitFor({ timeout: 30000 }); await choose('仿制图章'); await pick([.15, .15]); await move([.5, .4]); await shoot('canvas-donor-overlay')
        await draw([.5, .4], [.6, .4]); await shoot('canvas-clone-applied')
        await host.getByRole('button', { name: '撤销', exact: true }).click(); await shoot('canvas-one-undo')
      } finally { await restore() }
    },
  }
}
module.exports = { createImageEditRetouchScene }
