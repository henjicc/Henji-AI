function createGpuBudgetScenes(context) {
  const { settlePage, clickNamedButton, setupToolbox } = context

  return [{
    id: 'image-editor-gpu-budget-fallback',
    surface: '工具箱',
    name: '图片编辑器-GPU预算后备',
    setup: async (page, electronApp, helpers = {}) => {
      const fixturePath = process.env.HENJI_VGPU_GLOW_FIXTURE_IMAGE
      if (!fixturePath || !electronApp) throw new Error('GPU预算后备验收缺少test01夹具')
      await setupToolbox(page)
      await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
      const surface = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
      await surface.waitFor({ state: 'visible', timeout: 12000 })
      const editor = surface.locator('[data-image-editor-v3]')
      const previousEditor = await editor.isVisible() ? await editor.elementHandle() : null
      const startedAt = new Date().toISOString()
      await electronApp.evaluate(({ dialog }, selectedPath) => {
        const key = '__henjiGpuBudgetOpenDialog'
        globalThis[key] = dialog.showOpenDialog
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
      }, fixturePath)
      try {
        const openSource = surface.getByRole('button', {
          name: previousEditor ? /^(打开|Open)$/i : /^(从文件打开|Open from file)$/i,
        }).first()
        await openSource.click()
        if (previousEditor) {
          await page.getByRole('button', { name: /^(从文件打开|Open from file)$/i })
            .last().click()
        }
      } finally {
        await electronApp.evaluate(({ dialog }) => {
          const key = '__henjiGpuBudgetOpenDialog'
          const original = globalThis[key]
          if (typeof original === 'function') dialog.showOpenDialog = original
          delete globalThis[key]
        })
      }
      if (previousEditor) {
        await page.waitForFunction((element) => !element.isConnected, previousEditor, { timeout: 20000 })
      }
      await page.keyboard.press('Escape')
      const addLayer = surface.getByRole('button', { name: /^(添加图层|Add layer)$/i })
      await addLayer.waitFor({ state: 'visible', timeout: 20000 })
      process.stdout.write('  GPU预算后备：已导入test01\n')
      await addLayer.click()
      await page.getByRole('menuitem', { name: '辉光 Pro' }).click()
      const preview = surface.locator('[data-preview-surface]')
      await page.waitForFunction(() => {
        const value = document.querySelector('[data-preview-surface]')
        const diagnostics = document.querySelector('[data-presentation-front-surface]')
        return value?.getAttribute('data-preview-composition-backend') === 'gpu'
          && value?.getAttribute('data-preview-presentation-backend') === 'webgpu-surface'
          && Number(diagnostics?.getAttribute('data-gpu-surface-frame-count') ?? '0') > 0
          && Number(diagnostics?.getAttribute('data-gpu-image-bitmap-frame-count') ?? '-1') === 0
      }, undefined, { timeout: 20000 }).catch(async (error) => {
        const state = await preview.evaluate((value) => ({
          composition: value.getAttribute('data-preview-composition-backend'),
          effect: value.getAttribute('data-preview-effect-backend'),
          presentation: value.getAttribute('data-preview-presentation-backend'),
          device: value.getAttribute('data-preview-device-status'),
        }))
        throw new Error(`GPU预算后备等待fit帧失败：${JSON.stringify(state)}；${String(error)}`)
      })
      await settlePage(page, 500)
      if (typeof helpers.capture === 'function') await helpers.capture('gpu-fit')

      await surface.locator('[data-tool-id="zoom"]').click()
      const box = await preview.boundingBox()
      if (!box) throw new Error('GPU预算后备无法读取预览区')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      let zoomSteps = 0
      for (; zoomSteps < 12; zoomSteps += 1) {
        await page.mouse.wheel(0, -1)
        await page.waitForTimeout(50)
        if (await preview.getAttribute('data-preview-device-status') === 'fallback') break
      }
      await page.waitForFunction(() => {
        const value = document.querySelector('[data-preview-surface]')
        return value?.getAttribute('data-preview-device-status') === 'fallback'
          && value?.getAttribute('data-preview-composition-backend') === 'cpu'
          && value?.getAttribute('data-preview-presentation-backend') === 'canvas2d'
      }, undefined, { timeout: 5000 })
      const visiblePixels = await surface.locator('[data-presentation-front-surface]').evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return 0
        const context2d = canvas.getContext('2d')
        if (!context2d) return 0
        const pixels = context2d.getImageData(0, 0, canvas.width, canvas.height).data
        let visible = 0
        for (let offset = 0; offset < pixels.length; offset += 256) {
          if (pixels[offset] || pixels[offset + 1] || pixels[offset + 2] || pixels[offset + 3]) visible += 1
        }
        return visible
      })
      if (visiblePixels === 0) throw new Error('GPU超预算后备丢失稳定帧，画面全黑')
      await settlePage(page, 500)
      const evidence = await page.evaluate(async (afterTimestamp) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10), afterTimestamp, limit: 100,
        })
        return {
          errors: result.events.filter((event) => event.level === 'error'),
          fallbacks: result.events.filter((event) => (
            event.event === 'image_editor_v3.gpu_scene.resource_budget_fallback'
          )),
        }
      }, startedAt)
      if (evidence.errors.length > 0 || evidence.fallbacks.length !== 1) {
        throw new Error(`GPU预算后备日志不稳定：${JSON.stringify(evidence)}`)
      }
      process.stdout.write(`  GPU预算后备：${JSON.stringify({
        zoomSteps: zoomSteps + 1, fallbackCount: evidence.fallbacks.length,
        errorCount: evidence.errors.length, visiblePixels,
      })}\n`)
    },
  }]
}

module.exports = { createGpuBudgetScenes }
