function createGpuAnnotationScenes(context) {
  const { settlePage, clickNamedButton, setupToolbox } = context

  return [{
    id: 'image-editor-gpu-annotation-cache',
    surface: '工具箱',
    name: '图片编辑器-GPU标注缓存',
    writesUserData: true,
    setup: async (page) => {
      await setupToolbox(page)
      await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
      const surface = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
      await surface.waitFor({ state: 'visible', timeout: 12000 })
      const dropTarget = surface.locator('.border-dashed').first()
      await dropTarget.waitFor({ state: 'visible', timeout: 12000 })
      await dropTarget.evaluate(async (element) => {
        const canvas = document.createElement('canvas')
        canvas.width = 1200; canvas.height = 760
        const context2d = canvas.getContext('2d')
        if (!context2d) throw new Error('GPU标注夹具不可用')
        const gradient = context2d.createLinearGradient(0, 0, 1200, 760)
        gradient.addColorStop(0, 'rgb(25, 62, 132)')
        gradient.addColorStop(1, 'rgb(245, 172, 86)')
        context2d.fillStyle = gradient
        context2d.fillRect(0, 0, 1200, 760)
        const blob = await new Promise((resolve, reject) => canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('GPU标注夹具编码失败')), 'image/png',
        ))
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], 'gpu-annotation-cache.png', { type: 'image/png' }))
        element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true,
          dataTransfer: transfer }))
      })
      const editor = surface.locator('[data-image-editor-v3]')
      await editor.waitFor({ state: 'visible', timeout: 20000 })
      const preview = editor.locator('[data-preview-surface]')
      const front = editor.locator('[data-presentation-front-surface]')
      await page.waitForFunction(() => (
        document.querySelector('[data-preview-surface]')
          ?.getAttribute('data-preview-composition-backend') === 'gpu'
      ), undefined, { timeout: 20000 })
      const sampleFront = () => front.evaluate((canvas) => {
        if (!(canvas instanceof HTMLCanvasElement)) return []
        const sample = document.createElement('canvas')
        sample.width = 128; sample.height = 80
        const context2d = sample.getContext('2d', { willReadFrequently: true })
        if (!context2d) return []
        context2d.drawImage(canvas, 0, 0, sample.width, sample.height)
        return [...context2d.getImageData(0, 0, sample.width, sample.height).data]
      })
      const before = {
        generation: Number(await front.getAttribute('data-render-generation')),
        uploadCount: Number(await front.getAttribute('data-gpu-upload-count')),
      }
      const beforePixels = await sampleFront()
      const startedAt = new Date().toISOString()
      await editor.locator('[data-tool-id="annotation"]').click()
      await editor.getByRole('button', { name: /^(矩形标注|Rectangle annotation)$/i }).click()
      const overlay = editor.locator('[data-annotation-editor-overlay]')
      await overlay.waitFor({ state: 'visible', timeout: 5000 })
      const [overlayBox, previewBox] = await Promise.all([overlay.boundingBox(), preview.boundingBox()])
      if (!overlayBox || !previewBox) throw new Error('GPU标注画布范围不可用')
      const left = Math.max(overlayBox.x, previewBox.x)
      const top = Math.max(overlayBox.y, previewBox.y)
      const right = Math.min(overlayBox.x + overlayBox.width, previewBox.x + previewBox.width)
      const bottom = Math.min(overlayBox.y + overlayBox.height, previewBox.y + previewBox.height)
      await page.mouse.move(left + (right - left) * 0.22, top + (bottom - top) * 0.28)
      await page.mouse.down()
      await page.mouse.move(left + (right - left) * 0.58, top + (bottom - top) * 0.62, { steps: 8 })
      await page.mouse.up()
      await editor.locator('[role="treeitem"][data-layer-type="annotation"]')
        .waitFor({ state: 'visible', timeout: 10000 })
      await editor.locator('[data-tool-id="move"]').click()
      await settlePage(page, 300)
      const liveGeneration = Number(await front.getAttribute('data-render-generation'))
      await editor.getByRole('button', { name: /^(添加图层|Add layer)$/i }).click()
      await page.getByRole('menuitem', { name: /^(模糊|Blur)$/i }).click()
      const effectRow = editor.locator('[role="treeitem"][data-layer-type="effect"]')
      await effectRow.waitFor({ state: 'visible', timeout: 10000 })
      await effectRow.click()
      await editor.getByRole('button', { name: /^(上移图层|Move layer up)$/i }).click()
      await settlePage(page, 300)
      const annotationEditor = editor.locator('[data-annotation-editor-overlay]')
      const liveLayerCount = await annotationEditor.count() > 0
        ? await annotationEditor.getAttribute('data-live-annotation-layer-count') : '0'
      if (liveLayerCount !== '0') {
        const layerState = await editor.locator('[role="treeitem"][data-layer-type]')
          .evaluateAll((items) => items.map((item) => ({
            type: item.getAttribute('data-layer-type'), selected: item.getAttribute('aria-selected'),
          })))
        throw new Error(`标注未进入 RenderPlan：${JSON.stringify({ liveLayerCount, layerState })}`)
      }
      await page.waitForFunction((generation) => Number(
        document.querySelector('[data-presentation-front-surface]')
          ?.getAttribute('data-render-generation') ?? '0',
      ) > generation, liveGeneration, { timeout: 20000 })
      let initialUploads = []
      const uploadDeadline = Date.now() + 20000
      while (initialUploads.length === 0 && Date.now() < uploadDeadline) {
        initialUploads = await page.evaluate(async (afterTimestamp) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10), afterTimestamp, limit: 300,
          })
          return result.events.filter((event) => (
            event.event === 'image_editor_v3.gpu_scene.annotation_texture_uploaded'
          ))
        }, startedAt)
        if (initialUploads.length === 0) await page.waitForTimeout(100)
      }
      if (initialUploads.length === 0) {
        const state = await preview.evaluate((value) => ({
          composition: value.getAttribute('data-preview-composition-backend'),
          effect: value.getAttribute('data-preview-effect-backend'),
          presentation: value.getAttribute('data-preview-presentation-backend'),
          device: value.getAttribute('data-preview-device-status'),
        }))
        const liveCount = await editor.locator('[data-annotation-editor-overlay]')
          .getAttribute('data-live-annotation-layer-count')
        const layerTypes = await editor.locator('[role="treeitem"][data-layer-type]')
          .evaluateAll((items) => items.map((item) => item.getAttribute('data-layer-type')))
        throw new Error(`GPU标注纹理未上传：${JSON.stringify({ state, liveCount, layerTypes })}`)
      }
      const cacheStartedAt = new Date().toISOString()
      await settlePage(page, 800)
      const after = {
        generation: Number(await front.getAttribute('data-render-generation')),
        uploadCount: Number(await front.getAttribute('data-gpu-upload-count')),
        readbackCount: Number(await front.getAttribute('data-gpu-readback-count')),
      }
      await settlePage(page, 800)
      const repeatedUploadCount = Number(await front.getAttribute('data-gpu-upload-count'))
      const afterPixels = await sampleFront()
      const changedSamples = afterPixels.reduce((count, value, index) => (
        count + (Math.abs(value - (beforePixels[index] ?? value)) > 8 ? 1 : 0)
      ), 0)
      const logs = await page.evaluate(async ({ afterTimestamp, cacheTimestamp }) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10), afterTimestamp, limit: 300,
        })
        const repeated = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10), afterTimestamp: cacheTimestamp, limit: 100,
        })
        return {
          errors: result.events.filter((event) => event.level === 'error'),
          repeatedUploads: repeated.events.filter((event) => (
            event.event === 'image_editor_v3.gpu_scene.annotation_texture_uploaded'
          )),
        }
      }, { afterTimestamp: startedAt, cacheTimestamp: cacheStartedAt })
      const versions = new Set(initialUploads.map((event) => event.context?.contentVersion))
      if (initialUploads.length < 1 || versions.size !== 1 || logs.repeatedUploads.length !== 0
        || after.readbackCount !== 0
        || repeatedUploadCount !== after.uploadCount || changedSamples < 8 || logs.errors.length > 0) {
        throw new Error(`GPU标注缓存证据异常：${JSON.stringify({
          before, after, repeatedUploadCount, initialUploadCount: initialUploads.length,
          contentVersions: [...versions], changedSamples, logs,
        })}`)
      }
      process.stdout.write(`  GPU标注缓存：${JSON.stringify({
        uploadDelta: after.uploadCount - before.uploadCount,
        repeatedUploadDelta: repeatedUploadCount - after.uploadCount,
        annotationTileUploads: initialUploads.length, contentVersions: versions.size,
        changedSamples, readbackCount: after.readbackCount,
      })}\n`)
    },
  }]
}

module.exports = { createGpuAnnotationScenes }
