/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 色彩/导出场景。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { loadTypeScript } = require('../check-persistence-compat.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

function createImageEditColorExportScene(context) {
  return {
    id: 'image-edit-color-export', surface: '图片编辑', name: '色彩指定/转换、精度、专业导出与恢复', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    expectedLogEvents: ['image_editor_v3.toolbox.raster_export.failed', 'image_edit.color.prepare.failed'],
    setup: async (page, app, inspection) => {
      const restorePaid = await blockPaidGeneration(app)
      const host = () => page.locator('[data-image-editor-v3]:visible').last()
      const panel = () => host().locator('[data-color-management-panel]')
      const tab = async () => { await host().locator('[data-dock-tab="color"] > span').first().click(); await panel().waitFor() }
      const shoot = async name => {
        await context.settlePage(page, 500)
        await host().locator('[data-preview-target-mip-coverage="1.0000"]').waitFor({ timeout: 30000 })
        assert.equal(await host().locator('[data-command-bar]').count(), 1)
        assert.ok(await host().locator('[data-context-bar]').count() <= 1)
        await inspection.capture(name)
      }
      const choose = async (field, value) => { await panel().getByRole('button', { name: new RegExp(`^${field}`) }).click(); await page.getByRole('option', { name: value, exact: true }).click() }
      const apply = async expected => {
        await panel().getByRole('button', { name: '应用颜色配置', exact: true }).click()
        await panel().locator('[data-document-color]').filter({ hasText: new RegExp(`^${expected}\\s*·`) }).waitFor({ timeout: 120000 })
      }
      const restoreFault = async () => app.evaluate(({ ipcMain }) => {
        for (const [channel, handler] of Object.entries(globalThis.__colorExportHandlers ?? {})) {
          ipcMain.removeHandler(channel); ipcMain.handle(channel, handler)
        }
        globalThis.__colorExportHandlers = {}
      })
      const fault = async kind => app.evaluate(({ ipcMain }, kind) => {
        const channel = kind === 'disk' ? 'imageEditorV3:rasterExport:start' : 'imageEditorV3:rasterExport:writeTile'
        const handler = ipcMain._invokeHandlers.get(channel)
        globalThis.__colorExportHandlers ??= {}; globalThis.__colorExportHandlers[channel] = handler
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, kind === 'disk'
          ? () => ({ ok: false, error: { name: 'Error', code: 'ENOSPC', message: '磁盘空间不足，请清理空间后重试导出' } })
          : async (event, payload) => { await new Promise(resolve => setTimeout(resolve, 2000)); return handler(event, payload) })
      }, kind)
      const target = path.resolve('.reality/t119-17-display-p3-16.png')
      const exportPng = async () => {
        await host().getByRole('button', { name: '选择栅格导出格式', exact: true }).click()
        await page.locator('[data-export-format="png16"]').click()
      }
      try {
        await host().waitFor({ timeout: 30000 }); await tab(); await shoot('color-initial-proof-boundary')
        await panel().getByText(/尚未开放打印软打样/).scrollIntoViewIfNeeded(); await shoot('soft-proof-boundary')
        await panel().evaluate(element => { element.scrollTop = 0 })
        await choose('工作色域', 'display-p3'); await choose('位深', '16 位'); await shoot('p3-16-configuration')
        await apply('display-p3'); await shoot('p3-converted-appearance')
        await host().getByRole('button', { name: '选择栅格导出格式', exact: true }).click()
        const formats = await page.locator('[data-export-format]').evaluateAll(items => items.map(item => item.dataset.exportFormat))
        assert.ok(formats.includes('png16') && formats.includes('tiff16') && formats.includes('bigtiff'))
        await shoot('professional-format-menu'); await page.keyboard.press('Escape')
        await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }) }, target)
        await exportPng(); await host().getByRole('button', { name: '选择栅格导出格式', exact: true }).waitFor({ timeout: 120000 })
        assert.ok((await fs.stat(target)).size > 0)
        const reimport = await page.evaluate(filePath => window.henjiNative.imageEditorV3.ingestSource({ requestId: `color-roundtrip-${crypto.randomUUID()}`, source: { kind: 'local-path', filePath } }), target)
        assert.equal(reimport.metadata.bitsPerSample, 16); assert.equal(reimport.metadata.hasIccProfile, true)
        await shoot('p3-export-roundtrip')
        await fault('delay'); await exportPng()
        await host().getByRole('button', { name: '取消导出', exact: true }).waitFor(); await inspection.capture('export-progress-cancellable')
        await host().getByRole('button', { name: '取消导出', exact: true }).click()
        await host().getByRole('button', { name: '选择栅格导出格式', exact: true }).waitFor({ timeout: 30000 })
        await restoreFault(); await shoot('export-cancelled')
        await fault('disk'); await exportPng(); await page.getByText(/磁盘空间不足/).first().waitFor(); await shoot('disk-error-keeps-document')
        await restoreFault(); await exportPng(); await host().getByRole('button', { name: '选择栅格导出格式', exact: true }).waitFor({ timeout: 120000 }); await shoot('disk-retry-succeeded')
        await choose('处理方式', '指定配置'); await choose('工作色域', 'srgb'); await apply('srgb'); await shoot('assigned-profile')
        await host().getByRole('button', { name: '撤销', exact: true }).click(); await panel().locator('[data-document-color]').filter({ hasText: 'display-p3' }).waitFor(); await shoot('color-one-step-undo')
        await choose('传递函数', 'pq'); await panel().getByRole('button', { name: '应用颜色配置', exact: true }).click()
        await panel().getByText(/HDR 需要 Rec.2020/).waitFor(); await panel().getByText(/HDR 需要 Rec.2020/).scrollIntoViewIfNeeded(); await shoot('invalid-hdr-recoverable')
        await choose('传递函数', 'srgb')
        await choose('工作色域', 'rec2020'); await choose('传递函数', 'pq'); await apply('rec2020'); await shoot('hdr-working-document')
        const hdrTarget = path.resolve('.reality/t119-17-hdr12.avif')
        await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }) }, hdrTarget)
        await host().getByRole('button', { name: '选择栅格导出格式', exact: true }).click(); await shoot('hdr-professional-format-menu')
        await page.locator('[data-export-format="avif12"]').click()
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === '选择栅格导出格式' && !button.disabled), null, { timeout: 120000 })
        assert.ok((await fs.stat(hdrTarget)).size > 0); await shoot('hdr-avif12-exported')
        await host().getByRole('button', { name: '撤销', exact: true }).click(); await panel().locator('[data-document-color]').filter({ hasText: /^display-p3/ }).waitFor()
        // Shared formal fixture includes sparse masks, group blending, exposure and pixel layers.
        await context.setupCanvasMultiLayerDocumentEditor(page, app, { ...inspection, fixtureOnly: true })
        await tab(); await choose('工作色域', 'display-p3'); await choose('位深', '16 位'); await apply('display-p3'); await shoot('canvas-all-content-p3')
        const exportButton = page.getByRole('button', { name: '导出到画布', exact: true })
        await exportButton.click(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '导出到画布' && !button.disabled), null, { timeout: 120000 })
        await shoot('canvas-all-content-exported')
        await page.getByRole('dialog', { name: /多图层图片编辑器/ }).getByRole('button', { name: '关闭编辑器', exact: true }).click()
        const factory = loadTypeScript('src/core/imageEdit/v3/documentFactory.ts')
        const vector = loadTypeScript('src/core/imaging/vectorContent/index.ts')
        const layers = loadTypeScript('src/core/imageEdit/v3/layerTypes.ts')
        const text = factory.createImageEditTextLayerV3('export-title', '专业导出文字')
        text.content.box = { x: 60, y: 48, width: 600, height: 0 }
        text.content.paragraphs[0].runs[0].text = '痕迹 AI · 16 位色彩'
        text.content.paragraphs[0].runs[0].style = { ...vector.defaultTextStyle(720), fontSize: 40 }
        const shape = factory.createImageEditPathLayerV3('export-shape', '矢量蒙版形状')
        shape.content.operands[0].path = vector.rectanglePath(100, 160, 300, 240)
        shape.mask = { ...layers.createImageEditSparseMaskReferenceV3('export-mask'), vectorPaths: [{ operation: 'replace', path: vector.ellipsePath(130, 180, 240, 180) }] }
        const blur = factory.createImageEditEffectLayerV3('export-blur', '柔化', 'image.fast-blur-v3', { radius: 2 })
        const grade = factory.createImageEditAdjustmentLayerV3('export-grade', '曝光', 'exposure', { stops: .2 })
        const mixed = await openCanvasImageEditorV3Fixture({ page, context, width: 800, height: 600, label: '文字蒙版滤镜专业导出', vectorLayers: [shape, blur, grade, text] })
        await tab(); await choose('工作色域', 'display-p3'); await choose('位深', '16 位'); await apply('display-p3'); await shoot('text-mask-filter-p3')
        await page.getByRole('button', { name: '导出到画布', exact: true }).click()
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '导出到画布' && !button.disabled), null, { timeout: 120000 })
        const resultPath = await page.evaluate(async ({ projectId, nodeId }) => {
          const canvas = await window.henjiNative.testFixtures.readCanvas(projectId)
          const result = canvas.nodes.find(node => node.type === 'exportImageNode' && canvas.edges.some(edge => edge.source === nodeId && edge.target === node.id))
          if (!result?.data.imageUrl) throw new Error('正式画布导出未产生可读产物')
          return window.henjiNative.image.persistImageSource(result.data.imageUrl)
        }, { projectId: mixed.projectId, nodeId: mixed.fixture.nodeId })
        await page.getByRole('dialog', { name: /多图层图片编辑器/ }).getByRole('button', { name: '关闭编辑器', exact: true }).click()
        await context.setupToolbox(page); await context.clickNamedButton(page, /^(图片编辑|Image Edit)/i)
        await app.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }) }, resultPath)
        // Re-entering the tool resumes the launch source; wait for that load before opening the exported file.
        await host().waitFor({ timeout: 30000 })
        await host().getByRole('button', { name: '打开', exact: true }).click()
        await page.getByRole('button', { name: '打开图片', exact: true }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: '不保存', exact: true }).click()
        await host().waitFor({ timeout: 30000 }); await tab(); await panel().locator('[data-document-color]').filter({ hasText: 'float32' }).waitFor()
        await shoot('full-content-export-reopened')
      } catch (error) { await inspection.capture('failure'); throw error }
      finally { await restoreFault(); await restorePaid() }
    },
  }
}
module.exports = { createImageEditColorExportScene }
