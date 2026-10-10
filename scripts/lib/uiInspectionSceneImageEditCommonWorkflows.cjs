/* eslint-disable @typescript-eslint/no-var-requires -- 复用正式 Electron 场景和截图入口。 */
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

function createImageEditCommonWorkflowsScene(context, canvas = false, large = false) {
  const source = large ? '.reality/t139-4k.png' : 'tests/fixtures/image-inpainting/face-scratch-source.png'
  return {
    id: `image-edit-common-workflows-${canvas ? 'canvas' : 'toolbox'}${large ? '-4k' : ''}`,
    surface: canvas ? '画布' : '工具箱', name: `常用图片工作流-${canvas ? '画布图片节点' : '工具箱'}${large ? '-4K' : ''}`,
    writesUserData: true,
    ...(canvas ? {} : { launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'] }),
    setup: async (page, app, { capture }) => {
      const pageErrors = []
      const recordError = error => pageErrors.push(error.stack || error.message)
      page.on('pageerror', recordError)
      const restorePaid = await blockPaidGeneration(app)
      const shot = async name => { await context.settlePage(page, 400); await capture(name) }
      let host = page.locator('[data-image-editor-v3]:visible').last()
      try {
        if (!canvas && !large) {
          await host.waitFor({ timeout: 60000 })
          await app.evaluate(({ ipcMain, nativeImage }, filePath) => {
            const channel = 'clipboard:readImage'
            globalThis.__t139Clipboard = { channel, original: ipcMain._invokeHandlers.get(channel), reads: 0 }
            ipcMain.removeHandler(channel)
            ipcMain.handle(channel, () => {
              const fixture = globalThis.__t139Clipboard
              return { ok: true, data: ++fixture.reads === 1 ? null : { dataUrl: nativeImage.createFromPath(filePath).toDataURL(), name: '粘贴照片.png', origin: 'bitmap' } }
            })
          }, path.resolve(source))
          const paste = async () => {
            await host.getByRole('button', { name: '打开', exact: true }).click()
            await page.getByRole('button', { name: '粘贴剪贴板图片', exact: true }).click()
          }
          await paste(); await shot('clipboard-empty-recoverable')
          await paste(); await page.getByRole('button', { name: '不保存', exact: true }).click()
          await host.waitFor({ timeout: 60000 })
          await host.locator('[data-raster-source-ready="true"]').first().waitFor({ state: 'attached', timeout: 60000 })
          assert.equal(await app.evaluate(() => globalThis.__t139Clipboard.reads), 2)
          await shot('clipboard-photo-opened')
        }
        if (large) {
          await fs.mkdir(path.dirname(path.resolve(source)), { recursive: true })
          await require('sharp')(path.resolve('tests/fixtures/image-inpainting/face-scratch-source.png')).resize(3840, 2160, { fit: 'fill' }).png().toFile(path.resolve(source))
          if (!canvas) {
            await host.waitFor({ timeout: 60000 })
            await app.evaluate(({ dialog }, filePath) => {
              globalThis.__t139OpenDialog = dialog.showOpenDialog
              dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
            }, path.resolve(source))
            await host.getByRole('button', { name: '打开', exact: true }).click()
            await page.getByRole('button', { name: '打开图片', exact: true }).click()
            await page.getByRole('button', { name: '不保存', exact: true }).click()
            await page.waitForFunction(() => document.querySelector('[data-preview-surface]')?.getAttribute('data-preview-output-width') === '3840', null, { timeout: 60000 })
          }
        }
        if (canvas) {
          const sourcePath = path.resolve(source)
          const { width, height } = await require('sharp')(sourcePath).metadata()
          ;({ editor: host } = await openCanvasImageEditorV3Fixture({ page, context, width, height, sourcePath, label: '常用工作流照片' }))
        }
        await host.waitFor({ timeout: 60000 })
        await host.locator('[data-raster-source-ready="true"]').first().waitFor({ state: 'attached', timeout: 60000 })
        const tab = async id => { await host.locator(`[data-dock-tab="${id}"] > span`).first().click(); await context.settlePage(page, 150) }
        const rev = async () => Number(await host.locator('[data-command-bar]').getAttribute('data-document-revision'))
        const press = async key => { await host.focus(); await page.keyboard.press(key) }
        const choose = async (group, name) => { await host.getByRole('button', { name: group, exact: true }).click(); await page.getByRole('menuitem', { name, exact: true }).click() }
        await shot('opened-photo')
        for (const [key, id] of [['v','move'],['m','select-rect'],['l','select-lasso'],['b','raster-brush'],['e','eraser'],['t','vector'],['c','crop']]) {
          await press(key)
          assert.equal(await host.locator(`[data-tool-id="${id}"]`).getAttribute('aria-pressed'), 'true', `工具快捷键 ${key}`)
        }
        await press('v'); await press('Control+1')
        assert.ok(Math.abs(Number(await host.locator('[data-preview-surface]').getAttribute('data-preview-display-zoom')) - 1) < .001)
        await shot('actual-pixels')
        await press('Control+0'); await page.keyboard.down('Space')
        assert.equal(await host.locator('[data-preview-surface]').getAttribute('data-temporary-hand'), 'active')
        await shot('space-hand'); await page.keyboard.up('Space')

        if (large) {
          const before = await rev()
          await press('Control+1')
          const surface = host.locator('[data-preview-surface]'), area = await surface.boundingBox(); assert.ok(area)
          await page.keyboard.down('Space')
          await page.mouse.move(area.x + area.width * .5, area.y + area.height * .5); await page.mouse.down()
          await page.mouse.move(area.x + area.width * .7, area.y + area.height * .65, { steps: 30 }); await page.mouse.up(); await page.keyboard.up('Space')
          assert.equal(await rev(), before, '平移不得修改文档')
          await shot('4k-panned'); await press('Control+0'); await tab('adjustments')
          await host.getByRole('button', { name: '添加滤镜或调整', exact: true }).click()
          await page.getByRole('menuitem', { name: '曝光', exact: true }).click()
          const slider = host.locator('[data-filter-parameters]').getByRole('slider').first(); await slider.scrollIntoViewIfNeeded()
          await page.evaluate(() => { window.__t139Frames = []; window.__t139LastFrame = null; window.__t139Sampling = true; const sample = time => { if (!window.__t139Sampling) return; if (window.__t139LastFrame !== null) window.__t139Frames.push(time - window.__t139LastFrame); window.__t139LastFrame = time; requestAnimationFrame(sample) }; requestAnimationFrame(sample) })
          const bounds = await slider.boundingBox(); assert.ok(bounds); const revision = await rev()
          const initial = await slider.inputValue()
          await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5); await page.mouse.down()
          await page.mouse.move(bounds.x + bounds.width * .52, bounds.y + bounds.height * .5, { steps: 40 })
          assert.notEqual(await slider.inputValue(), initial); assert.equal(await rev(), revision)
          await page.mouse.up(); await shot('4k-adjustment')
          const metrics = await page.evaluate(() => { window.__t139Sampling = false; const frames = window.__t139Frames.slice().sort((a,b) => a-b); return { samples: frames.length, medianFrameMs: frames[Math.floor(frames.length * .5)], p95FrameMs: frames[Math.floor(frames.length * .95)] } })
          metrics.lastEventToPresentMs = await surface.getAttribute('data-preview-event-to-present-ms')
          metrics.presentationBackend = await surface.getAttribute('data-preview-presentation-backend')
          metrics.compositionBackend = await surface.getAttribute('data-preview-composition-backend')
          assert.ok(metrics.samples > 0)
          await fs.writeFile(path.resolve(`.reality/t139-4k-${canvas ? 'canvas' : 'toolbox'}-frames.json`), JSON.stringify(metrics, null, 2))
          return
        }

        // 轻微拉直沿已有图层旋转属性；裁剪输出保留原图，取消/撤销可恢复。
        await tab('properties')
        const rotate = host.getByRole('spinbutton', { name: '旋转 (°)', exact: true })
        if (await rotate.count()) { await rotate.fill('2'); await rotate.press('Enter'); await shot('straighten-rotation'); await press('Control+z') }
        await press('c')
        const crop = host.locator('[data-crop-parameters]')
        await crop.getByRole('button', { name: '向右旋转 90°', exact: true }).click()
        await crop.getByRole('button', { name: '水平镜像', exact: true }).click()
        await shot('crop-rotate-flip-preview')
        await crop.getByRole('button', { name: '取消', exact: true }).click()
        const width = crop.getByRole('spinbutton').nth(2), originalWidth = Number(await width.inputValue())
        await width.fill(String(Math.max(1, originalWidth - 40)))
        await shot('crop-preview'); await crop.getByRole('button', { name: '应用裁剪', exact: true }).click()
        await shot('crop-applied'); await press('Control+z'); await press('Control+y'); await shot('crop-redo'); await press('Control+z')

        await tab('layers'); await host.locator('[data-layer-select]').first().click()
        await tab('adjustments')
        await host.getByRole('button', { name: '添加滤镜或调整', exact: true }).click()
        await shot('adjustment-library'); await page.keyboard.press('Escape')
        for (const [index, name] of ['曝光', '色温 / 色调', '色相 / 饱和度 / 明度', '曲线', '全能调色'].entries()) {
          await host.getByRole('button', { name: '添加滤镜或调整', exact: true }).click()
          await page.getByRole('menuitem', { name, exact: true }).click()
          await host.locator('[data-filter-row]').last().waitFor()
          await shot(`adjustment-${index}`)
          const slider = host.locator('[data-filter-parameters]').getByRole('slider').first()
          if (await slider.count()) {
            await slider.scrollIntoViewIfNeeded()
            const box = await slider.boundingBox(); assert.ok(box)
            const before = await rev()
            await page.mouse.move(box.x + box.width * .45, box.y + box.height * .5); await page.mouse.down()
            await page.mouse.move(box.x + box.width * .58, box.y + box.height * .5, { steps: 12 })
            assert.equal(await rev(), before, '拖动预览不能逐帧写历史')
            await page.mouse.up(); await context.settlePage(page, 300)
          }
          if (name === '全能调色') {
            for (const label of ['对比度滑杆', '饱和度滑杆']) {
              const control = host.getByRole('slider', { name: label, exact: true })
              await control.scrollIntoViewIfNeeded()
              const bounds = await control.boundingBox(); assert.ok(bounds)
              const before = await rev()
              await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .5); await page.mouse.down()
              await page.mouse.move(bounds.x + bounds.width * .54, bounds.y + bounds.height * .5, { steps: 10 })
              assert.equal(await rev(), before)
              await page.mouse.up(); await context.settlePage(page, 300)
              await shot(label === '对比度滑杆' ? 'contrast-adjusted' : 'saturation-adjusted')
            }
          }
          await tab('layers'); await host.locator('[data-layer-select]').first().click(); await tab('adjustments')
        }
        await shot('adjustments-combined')
        await tab('layers'); await host.locator('[data-layer-select]').first().click()
        await press('t')
        const vector = host.locator('[data-vector-overlay]'), box = await vector.boundingBox(); assert.ok(box)
        await vector.click({ position: { x: box.width * .25, y: box.height * .3 } })
        const text = vector.getByRole('textbox', { name: '文字内容', exact: true })
        await text.fill('重点检查'); await text.press('Enter')
        await host.locator('[data-layer-type="text"]').waitFor(); await shot('text-added')
        await choose('文字与图形', '箭头')
        await page.mouse.move(box.x + box.width * .35, box.y + box.height * .55); await page.mouse.down()
        await page.mouse.move(box.x + box.width * .65, box.y + box.height * .4, { steps: 10 }); await page.mouse.up()
        await host.locator('[data-layer-type="shape"]').waitFor(); await shot('arrow-added')
        await choose('文字与图形', '矩形')
        await page.mouse.move(box.x + box.width * .2, box.y + box.height * .2); await page.mouse.down()
        await page.mouse.move(box.x + box.width * .6, box.y + box.height * .7, { steps: 10 }); await page.mouse.up()
        await shot('rectangle-added')
        await host.getByRole('button', { name: '复制图层', exact: true }).click(); await shot('layer-duplicated')
        await host.getByRole('button', { name: '下移图层', exact: true }).click(); await shot('layer-reordered')
        await tab('properties')
        await host.getByRole('button', { name: '添加蒙版', exact: true }).click(); await shot('layer-mask-added')
        await host.locator('[data-properties-tab="basics"]').click()
        await host.getByRole('button', { name: '混合模式', exact: true }).click()
        await page.getByRole('option', { name: '正片叠底', exact: true }).click(); await shot('layer-blend-mode')
        await tab('layers')
        await host.locator('[data-layer-select]').nth(0).click()
        await host.locator('[data-layer-select]').nth(1).click({ modifiers: ['Control'] })
        await host.getByRole('button', { name: '更多图层操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '将所选图层编组', exact: true }).click()
        await host.locator('[data-layer-type="group"]').waitFor(); await shot('layer-grouped')
        await press('Control+z'); await shot('layer-ungrouped-undo')
        await host.getByRole('button', { name: '添加图层', exact: true }).click()
        await page.getByRole('menuitem', { name: '栅格图层', exact: true }).click(); await shot('layer-created')
        await tab('history'); await host.locator('[data-image-history-row]').first().waitFor(); await shot('history-workflow')
        await tab('layers'); await press('v')
        if (canvas) {
          const rows = host.locator('[data-layer-select]')
          await rows.first().click()
          for (let index = 1; index < await rows.count(); index++) await rows.nth(index).click({ modifiers: ['Control'] })
          await host.getByRole('button', { name: '更多图层操作', exact: true }).click()
          await page.getByRole('menuitem', { name: '将所选图层编组', exact: true }).click()
          const nodeCount = await page.locator('.react-flow__node').count()
          await host.getByRole('button', { name: '导出到画布', exact: true }).click()
          await page.waitForFunction(count => document.querySelectorAll('.react-flow__node').length > count, nodeCount, { timeout: 60000 })
          await shot('delivered-to-canvas')
        } else {
          const filePath = path.resolve('.reality/t139-common-output.png')
          await fs.rm(filePath, { force: true })
          await app.evaluate(({ dialog }, filePath) => {
            globalThis.__t139SaveDialog = dialog.showSaveDialog
            dialog.showSaveDialog = async () => ({ canceled: false, filePath })
          }, filePath)
          await host.getByRole('button', { name: '选择栅格导出格式', exact: true }).click()
          await page.locator('[data-export-format="png8"]').click()
          await page.waitForFunction(() => !document.querySelector('[data-raster-export-progress]'), null, { timeout: 60000 })
          let output = null
          for (let attempt = 0; attempt < 60 && !output; attempt++) {
            output = await fs.stat(filePath).catch(() => null)
            if (!output) await context.settlePage(page, 500)
          }
          assert.ok(output?.size > 0, '导出必须写出本轮图片')
          const metadata = await require('sharp')(filePath).metadata()
          assert.equal(metadata.width, Number(await host.locator('[data-preview-surface]').getAttribute('data-preview-output-width')))
          await shot('exported-png')
        }
      } catch (error) {
        await capture('workflow-failure')
        const text = await host.innerText({ timeout: 1000 }).catch(() => page.locator('body').innerText())
        await fs.writeFile(path.resolve(`.reality/t139-${canvas ? 'canvas' : 'toolbox'}-workflow-errors.json`), JSON.stringify(pageErrors, null, 2))
        throw new Error(`${error.message}\n当前界面：${text.slice(-4500)}\n运行错误：${pageErrors.join('\n')}`, { cause: error })
      } finally {
        page.off('pageerror', recordError)
        await page.keyboard.up('Space'); await page.mouse.up()
        await app.evaluate(({ dialog }) => { if (globalThis.__t139SaveDialog) { dialog.showSaveDialog = globalThis.__t139SaveDialog; delete globalThis.__t139SaveDialog } })
        await app.evaluate(({ dialog }) => { if (globalThis.__t139OpenDialog) { dialog.showOpenDialog = globalThis.__t139OpenDialog; delete globalThis.__t139OpenDialog } })
        await app.evaluate(({ ipcMain }) => {
          const fixture = globalThis.__t139Clipboard
          if (fixture) { ipcMain.removeHandler(fixture.channel); if (fixture.original) ipcMain.handle(fixture.channel, fixture.original); delete globalThis.__t139Clipboard }
        })
        await restorePaid()
      }
    },
  }
}
module.exports = { createImageEditCommonWorkflowsScene }
