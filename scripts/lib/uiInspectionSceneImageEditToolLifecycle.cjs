/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检启动器使用 CommonJS 场景工厂。 */
const assert = require('node:assert/strict')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

/** Owned by t119-01; central catalog wiring belongs to 18. Uses the official Electron capture callback. */
function createImageEditToolLifecycleScene(context) {
  return {
    id: 'image-edit-tool-lifecycle', surface: '工具箱', name: '图片编辑-工具登记与输入生命周期', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    setup: async (page, app, { capture: captureRaw }) => {
      const capture = async suffix => { await context.settlePage(page); await captureRaw(suffix) }
      const restore = await blockPaidGeneration(app)
      try {
        const editor = page.locator('[data-image-editor-v3]:visible')
        await editor.waitFor({ state: 'visible', timeout: 30000 })
        const preview = editor.locator('[data-preview-surface]')
        await preview.waitFor({ state: 'visible' })
        await capture('registered-tools')
        await editor.locator('[data-tool-id="select-rect"]').click()
        const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: '套索选择', exact: true }) })
        await menu.waitFor({ state: 'visible' })
        await capture('selection-group')
        await menu.getByRole('menuitem', { name: '矩形选择', exact: true }).click()
        await menu.waitFor({ state: 'hidden' })
        await editor.focus()
        await page.keyboard.down('Space')
        await page.waitForFunction(element => element.getAttribute('data-temporary-hand') === 'active', await preview.elementHandle())
        assert.equal(await preview.getAttribute('data-temporary-hand'), 'active')
        await capture('temporary-hand')
        await page.keyboard.down('z')
        await page.waitForFunction(element => element.getAttribute('data-active-navigation-tool') === 'zoom', await preview.elementHandle())
        assert.equal(await preview.getAttribute('data-active-navigation-tool'), 'zoom')
        await capture('temporary-zoom')
        await page.keyboard.up('z')
        await page.keyboard.up('Space')
        await page.waitForFunction(element => element.getAttribute('data-active-navigation-tool') === null, await preview.elementHandle())
        assert.equal(await preview.getAttribute('data-active-navigation-tool'), null)
        assert.equal(await editor.locator('[data-tool-id="select-rect"]').getAttribute('aria-pressed'), 'true')
        await capture('navigation-restored')
        const selection = editor.locator('[data-tool-overlay-slot="selection"] svg')
        const box = await selection.boundingBox()
        if (!box) throw new Error('选区工作面没有可见边界')
        await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 6 })
        await capture('selection-draft')
        await page.keyboard.press('Escape')
        await page.mouse.up()
        assert.equal(await selection.locator('rect').count(), 0)
        await capture('selection-cancelled')
        await page.keyboard.press('h')
        assert.equal(await editor.locator('[data-tool-id="hand"]').getAttribute('aria-pressed'), 'true')
        await capture('options-closed')
        await page.keyboard.press('v')
        await editor.locator('[data-tool-id="vector"]').click()
        await capture('annotation-group')
        await page.getByRole('menuitem', { name: '文字', exact: true }).click()
        const annotation = editor.locator('[data-vector-overlay]')
        await annotation.click({ position: { x: box.width * 0.4, y: box.height * 0.4 } })
        const textbox = annotation.getByRole('textbox')
        await textbox.waitFor({ state: 'visible' })
        await textbox.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
        await textbox.fill('输入文字')
        await textbox.press('Space')
        assert.equal(await preview.getAttribute('data-temporary-hand'), null)
        await capture('ime-text-priority')
        await textbox.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
        await textbox.press('Escape')
        await capture('text-cancelled')
        const revision = () => editor.locator('[data-document-revision]').getAttribute('data-document-revision').then(Number)
        const waitRevision = async before => page.waitForFunction(({ root, before }) => Number(root.querySelector('[data-document-revision]')?.getAttribute('data-document-revision')) === before + 1,
          { root: await editor.elementHandle(), before }, { timeout: 180000 })
        await editor.locator('[data-layer-select]').filter({ hasText: '原图' }).click()
        const beforeAdjustment = await revision()
        await editor.getByRole('button', { name: '添加图层', exact: true }).click()
        await page.getByRole('menuitem', { name: '全能调色', exact: true }).click()
        await waitRevision(beforeAdjustment)
        await capture('adjustment-layer')
        await editor.getByRole('button', { name: '撤销', exact: true }).click()
        await editor.locator('[data-layer-select]').filter({ hasText: '原图' }).click()
        await editor.locator('[data-tool-id="remove"]').click()
        const region = editor.locator('[data-tool-overlay-slot="selection"] svg')
        const regionBox = await region.boundingBox()
        assert.ok(regionBox, '移除与修补必须复用真实选区工作面')
        // 细小瑕疵走已有本地快速修复；不触发云端模型。
        const brushSize = editor.getByRole('slider', { name: '大小', exact: true })
        await brushSize.press('Home')
        for (let step = 0; step < 3; step++) await brushSize.press('ArrowRight')
        await editor.focus()
        const beforeRemove = await revision()
        await page.mouse.move(regionBox.x + regionBox.width * 0.485, regionBox.y + regionBox.height * 0.39)
        await page.mouse.down()
        await page.mouse.move(regionBox.x + regionBox.width * 0.485, regionBox.y + regionBox.height * 0.40, { steps: 5 })
        await page.mouse.up()
        await waitRevision(beforeRemove)
        await capture('remove-result')
        await editor.locator('[data-tool-id="select-rect"]').click()
        await page.getByRole('menuitem', { name: '矩形选择', exact: true }).click()
        await page.mouse.move(regionBox.x + regionBox.width * 0.475, regionBox.y + regionBox.height * 0.385)
        await page.mouse.down()
        await page.mouse.move(regionBox.x + regionBox.width * 0.495, regionBox.y + regionBox.height * 0.405, { steps: 6 })
        await page.mouse.up()
        await editor.getByRole('button', { name: '取消选区', exact: true }).waitFor({ state: 'visible' })
        await context.settlePage(page)
        await editor.locator('[data-tool-id="repair"]').click()
        const beforeRepair = await revision()
        await page.mouse.move(regionBox.x + regionBox.width * 0.485, regionBox.y + regionBox.height * 0.395)
        await page.mouse.down()
        await page.mouse.move(regionBox.x + regionBox.width * 0.465, regionBox.y + regionBox.height * 0.395, { steps: 10 })
        await page.mouse.up()
        await waitRevision(beforeRepair)
        await capture('repair-result')
        await editor.locator('[data-tool-id="select-rect"]').click()
        await page.getByRole('menuitem', { name: '点选主体', exact: true }).click()
        await editor.getByRole('button', { name: '取消选区', exact: true }).click()
        await editor.getByRole('button', { name: '选择人像', exact: true }).click()
        await page.waitForFunction(root => {
          const buttons = [...root.querySelectorAll('button')]
          return buttons.some(button => button.textContent.trim() === '取消选区' && !button.disabled)
            && buttons.some(button => button.textContent.trim() === '选择人像' && !button.disabled)
        }, await editor.elementHandle(), { timeout: 180000 })
        await capture('subject-result')
      } finally {
        await page.keyboard.up('z')
        await page.keyboard.up('Space')
        await page.mouse.up()
        await restore()
      }
    },
  }
}

function createImageEditRegistrationFailureScene() {
  return {
    id: 'image-edit-registration-failure', surface: '工具箱', name: '图片编辑-工具登记失败与恢复', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    expectedLogEvents: ['image_editor.tools.registration.failed'],
    setup: async (page, app, { capture }) => {
      await page.locator('[data-image-editor-v3]:visible').waitFor({ state: 'visible', timeout: 30000 })
      // 仅故障这一轮渲染启动：命中带 overlay 的正式工具实现登记，清单不受影响。
      await page.addInitScript(() => {
        if (sessionStorage.getItem('__imageRegistrationFailureConsumed')) return
        const original = Map.prototype.set
        Map.prototype.set = function (key, value) {
          if (key === 'select-rect' && value?.id === key && Array.isArray(value.overlays)) {
            Map.prototype.set = original
            sessionStorage.setItem('__imageRegistrationFailureConsumed', 'true')
            throw new Error('巡检工具登记失败夹具')
          }
          return original.call(this, key, value)
        }
      })
      try {
        await page.reload()
        const editor = page.locator('[data-image-editor-v3]:visible')
        await editor.getByText('图片编辑工具无法加载，请关闭后重新打开编辑器。', { exact: true }).waitFor({ state: 'visible', timeout: 30000 })
        assert.equal(await editor.locator('[data-tool-id]').count(), 0, '登记失败不能留下可点击工具')
        const back = editor.getByRole('button', { name: '返回图片文档列表', exact: true })
        await back.waitFor({ state: 'visible', timeout: 10000 })
        await capture('registration-failed')
        await back.click()
        await page.getByRole('button', { name: '不保存', exact: true }).waitFor({ state: 'visible', timeout: 10000 })
        await page.getByRole('button', { name: '不保存', exact: true }).click()
        await editor.waitFor({ state: 'hidden', timeout: 10000 })
      } finally {
        await page.reload()
      }
      await page.locator('[data-preview-surface]:visible').waitFor({ state: 'visible', timeout: 30000 })
      await page.locator('[data-image-editor-v3]:visible [data-raster-pasteboard-layer][data-raster-source-ready="true"]').waitFor({ state: 'attached', timeout: 30000 })
      await page.evaluate(() => document.fonts.ready)
      await capture('registration-recovered')
    },
  }
}

function createImageEditQuickMarkViewerScene(context) {
  return {
    id: 'image-edit-quick-mark-viewer', surface: '生成', name: '图片查看器-快速标记与裁剪', writesUserData: true,
    setup: async (page, app, { capture }) => {
      await context.selectGenerationModel(page, 'Nano Banana 2', 'kie-nano-banana-2', 'kie')
      const previousReferences = await page.locator('img[alt^="参考 "]').count()
      await page.locator('input[type="file"][accept*="image"]').first().setInputFiles('tests/fixtures/image-inpainting/face-scratch-source.png')
      const reference = page.locator(`img[alt="参考 ${previousReferences + 1}"]`)
      await reference.waitFor({ state: 'visible', timeout: 15000 })
      await reference.evaluate(image => image.decode())
      await reference.click()
      const viewer = page.getByRole('dialog', { name: '图片', exact: true })
      await viewer.waitFor({ state: 'visible' })
      await context.settlePage(page)
      await capture('viewer')
      await viewer.getByRole('button', { name: '编辑', exact: true }).click()
      const editor = viewer.locator('[data-image-editor-v3][data-host-profile="quick"]')
      await editor.waitFor({ state: 'visible', timeout: 30000 })
      await editor.locator('[data-raster-pasteboard-layer][data-raster-source-ready="true"]').waitFor({ state: 'attached', timeout: 30000 })
      await editor.locator('.animate-spin').waitFor({ state: 'hidden', timeout: 30000 })
      assert.equal(await editor.getByRole('button', { name: '保存', exact: true }).count(), 1, '保存必须显示已翻译的操作名称')
      await context.settlePage(page)
      await capture('quick-default')
      await editor.getByRole('button',{name:'文字与图形',exact:true}).click()
      await page.getByRole('menuitem',{name:'箭头',exact:true}).click()
      const annotation = editor.locator('[data-vector-overlay]')
      const box = await annotation.boundingBox()
      assert.ok(box, '快速标记必须打开实际标注工作面')
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 12 })
      await page.mouse.up()
      await editor.locator('[data-layer-type="shape"]').waitFor({state:'visible'})
      await context.settlePage(page)
      await capture('quick-arrow')
      await editor.locator('[data-dock-tab="history"] > span').first().click()
      await editor.locator('[data-image-history-panel]').waitFor({ state: 'visible' })
      await editor.locator('[data-image-history-row]').first().waitFor()
      await context.settlePage(page, 400)
      await capture('quick-history')
      await editor.locator('[data-tool-id="crop"]').click()
      await editor.locator('[data-crop-overlay]').waitFor({ state: 'visible' })
      await context.settlePage(page)
      await capture('quick-crop')
      await page.keyboard.press('Escape')
      await editor.getByRole('button', { name: '关闭', exact: true }).click()
      await editor.waitFor({ state: 'hidden', timeout: 30000 })
      await capture('quick-returned-to-viewer')
    },
    cleanup: async page => {
      await page.mouse.up()
      const editor = page.locator('[data-image-editor-v3][data-host-profile="quick"]:visible')
      if (await editor.count()) await editor.getByRole('button', { name: '关闭', exact: true }).click()
      await context.closeTransientUi(page)
    },
  }
}

module.exports = { createImageEditToolLifecycleScene, createImageEditRegistrationFailureScene, createImageEditQuickMarkViewerScene }
