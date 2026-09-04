function createGpuBrushScenes(context) {
  const { settlePage, clickNamedButton, setupToolbox } = context

  return [{
    id: 'image-editor-gpu-brush',
    surface: '工具箱',
    name: '图片编辑器-GPU连续画笔',
    writesUserData: true,
    setup: async (page, _electronApp, helpers = {}) => {
      const queryFrames = (afterTimestamp) => page.evaluate(async (timestamp) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10),
          afterTimestamp: timestamp,
          domainPrefix: 'features.image_edit.v3.gpu_scene_bridge',
          limit: 300,
        })
        return result.events.filter((event) => (
          event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
        ))
      }, afterTimestamp)
      const waitForFrame = async (afterTimestamp, minimumGeneration = 0) => {
        const deadline = Date.now() + 20000
        while (Date.now() < deadline) {
          const frames = await queryFrames(afterTimestamp)
          const accepted = frames.filter((event) => (
            Number(event.context?.sceneGeneration) > minimumGeneration
          ))
          if (accepted.length > 0) return accepted.at(-1)
          await page.waitForTimeout(80)
        }
        throw new Error('等待 GPU 连续画笔帧超时')
      }
      const latestSettledFrame = async (afterTimestamp, minimumGeneration = 0) => {
        await waitForFrame(afterTimestamp, minimumGeneration)
        await page.waitForTimeout(800)
        const frames = await queryFrames(afterTimestamp)
        return frames.filter((event) => (
          Number(event.context?.sceneGeneration) > minimumGeneration
        )).at(-1)
      }

      await setupToolbox(page)
      await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
      const surface = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
      await surface.waitFor({ state: 'visible', timeout: 12000 })
      const editor = surface.locator('[data-image-editor-v3]')
      const dropTarget = surface.locator('.border-dashed').first()
      await Promise.race([
        editor.waitFor({ state: 'visible', timeout: 12000 }),
        dropTarget.waitFor({ state: 'visible', timeout: 12000 }),
      ])
      const previousEditor = await editor.isVisible() ? await editor.elementHandle() : null
      const importStartedAt = new Date().toISOString()
      if (!previousEditor) {
        await dropTarget.evaluate(async (element) => {
          const canvas = document.createElement('canvas')
          canvas.width = 1200
          canvas.height = 760
          const context = canvas.getContext('2d')
          if (!context) throw new Error('GPU 连续画笔夹具画布不可用')
          const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
          gradient.addColorStop(0, 'rgb(20, 56, 128)')
          gradient.addColorStop(0.5, 'rgb(232, 105, 82)')
          gradient.addColorStop(1, 'rgb(255, 221, 118)')
          context.fillStyle = gradient
          context.fillRect(0, 0, canvas.width, canvas.height)
          const blob = await new Promise((resolve, reject) => canvas.toBlob(
            (value) => value ? resolve(value) : reject(new Error('GPU 连续画笔夹具编码失败')),
            'image/png',
          ))
          const transfer = new DataTransfer()
          transfer.items.add(new File([blob], 'gpu-continuous-brush.png', { type: 'image/png' }))
          element.dispatchEvent(new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }))
        })
      }
      await editor.waitFor({ state: 'visible', timeout: 20000 })
      const preview = editor.locator('[data-preview-surface]')
      const gpuSurface = editor.locator('[data-presentation-front-surface]')
      try {
        await page.waitForFunction(() => {
          const previewElement = document.querySelector('[data-image-editor-v3] [data-preview-surface]')
          const gpu = document.querySelector('[data-image-editor-v3] [data-presentation-front-surface]')
          return previewElement?.getAttribute('data-preview-composition-backend') === 'gpu'
            && Number(gpu?.getAttribute('data-render-generation') ?? '0') > 0
            && Number(gpu?.getAttribute('data-gpu-upload-count') ?? '0') > 0
        }, undefined, { timeout: 20000 })
      } catch (error) {
        const issues = await page.evaluate(async (afterTimestamp) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10), afterTimestamp, limit: 300,
          })
          return result.events.filter((event) => (
            event.level === 'error' || event.event === 'image_editor_v3.gpu_scene.tile_load_failed'
          ))
        }, importStartedAt)
        throw new Error(`等待当前 GPU 画笔表面失败：${JSON.stringify(issues)}；${String(error)}`)
      }
      const readGpuEvidence = async () => ({
        generation: Number(await gpuSurface.getAttribute('data-render-generation')),
        uploadCount: Number(await gpuSurface.getAttribute('data-gpu-upload-count')),
        readbackCount: Number(await gpuSurface.getAttribute('data-gpu-readback-count')),
        backend: await preview.getAttribute('data-preview-composition-backend'),
      })
      const strokeYFraction = previousEditor ? 0.35 : 0.5
      const readStrokePixels = (position) => gpuSurface.evaluate((canvas, samplePosition) => {
        if (!(canvas instanceof HTMLCanvasElement)) throw new Error('GPU 呈现表面不是 canvas')
        const context = canvas.getContext('2d')
        if (!context) throw new Error('GPU 呈现表面不可读')
        const x = Math.max(0, Math.min(canvas.width - 5,
          Math.floor(canvas.width * samplePosition.xFraction) - 2))
        const y = Math.max(0, Math.min(canvas.height - 5,
          Math.floor(canvas.height * samplePosition.yFraction) - 2))
        return [...context.getImageData(x, y, 5, 5).data]
      }, position)
      const initial = await readGpuEvidence()
      const commandBar = editor.locator('[data-command-bar]')
      const readRevision = async () => Number(await commandBar.getAttribute('data-document-revision'))
      const brushButton = editor.locator('[data-tool-id="raster-brush"]')
      await brushButton.waitFor({ state: 'visible', timeout: 5000 })
      if (await brushButton.isDisabled()) throw new Error('选中可编辑栅格层时画笔仍被禁用')
      await brushButton.click()

      const overlay = editor.locator('[data-raster-brush-overlay]')
      await overlay.waitFor({ state: 'visible', timeout: 5000 })
      const box = await overlay.boundingBox()
      const gpuBox = await gpuSurface.boundingBox()
      if (!box || !gpuBox) throw new Error('GPU 连续画笔无法读取绘制区域')
      const beforeRevision = await readRevision()
      const strokeStartedAt = new Date().toISOString()
      const y = box.y + box.height * strokeYFraction
      const samplePosition = {
        xFraction: (box.x + box.width * 0.5 - gpuBox.x) / gpuBox.width,
        yFraction: (y - gpuBox.y) / gpuBox.height,
      }
      const initialPixels = await readStrokePixels(samplePosition)
      await page.mouse.move(box.x + box.width * 0.08, y)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width * 0.92, y, { steps: 100 })
      await page.mouse.up()
      await page.waitForFunction((revision) => (
        Number(document.querySelector('[data-command-bar]')?.getAttribute('data-document-revision')) === revision + 1
      ), beforeRevision, { timeout: 12000 })
      await page.waitForFunction(({ generation, uploadCount }) => {
        const previewElement = document.querySelector('[data-image-editor-v3] [data-preview-surface]')
        const gpu = document.querySelector('[data-image-editor-v3] [data-presentation-front-surface]')
        return previewElement?.getAttribute('data-preview-composition-backend') === 'gpu'
          && Number(gpu?.getAttribute('data-render-generation') ?? '0') > generation
          && Number(gpu?.getAttribute('data-gpu-upload-count') ?? '0') > uploadCount
      }, initial, { timeout: 20000 })
      const afterStroke = await readGpuEvidence()
      const strokePixels = await readStrokePixels(samplePosition)
      const uploadDelta = afterStroke.uploadCount - initial.uploadCount
      if (uploadDelta < 1 || uploadDelta > 4) {
        throw new Error(`100次采样只应上传跨越的脏瓦片，实际增量=${uploadDelta}`)
      }
      if (strokePixels.every((value, index) => Math.abs(value - initialPixels[index]) <= 1)) {
        throw new Error('100次采样完成后中心像素未变化')
      }

      const beforeUndo = await readRevision()
      await editor.getByRole('button', { name: /^(撤销|Undo)$/i }).click()
      await page.waitForFunction((revision) => (
        Number(document.querySelector('[data-command-bar]')?.getAttribute('data-document-revision')) === revision + 1
      ), beforeUndo, { timeout: 8000 })
      await page.waitForFunction((generation) => Number(
        document.querySelector('[data-image-editor-v3] [data-presentation-front-surface]')
          ?.getAttribute('data-render-generation') ?? '0'
      ) > generation, afterStroke.generation, { timeout: 20000 })
      const afterUndo = await readGpuEvidence()
      const undoPixels = await readStrokePixels(samplePosition)
      if (undoPixels.some((value, index) => Math.abs(value - initialPixels[index]) > 1)) {
        throw new Error('撤销后中心像素未恢复笔画前内容')
      }
      const beforeRedo = await readRevision()
      await editor.getByRole('button', { name: /^(重做|Redo)$/i }).click()
      await page.waitForFunction((revision) => (
        Number(document.querySelector('[data-command-bar]')?.getAttribute('data-document-revision')) === revision + 1
      ), beforeRedo, { timeout: 8000 })
      await page.waitForFunction((generation) => Number(
        document.querySelector('[data-image-editor-v3] [data-presentation-front-surface]')
          ?.getAttribute('data-render-generation') ?? '0'
      ) > generation, afterUndo.generation, { timeout: 20000 })
      const afterRedo = await readGpuEvidence()
      const redoPixels = await readStrokePixels(samplePosition)
      if (redoPixels.some((value, index) => Math.abs(value - strokePixels[index]) > 1)) {
        throw new Error('重做后中心像素未恢复笔画内容')
      }
      if (afterUndo.uploadCount !== afterStroke.uploadCount
        || afterRedo.uploadCount !== afterStroke.uploadCount) {
        throw new Error(`撤销/重做不应重传已驻留瓦片：${JSON.stringify({ afterStroke, afterUndo, afterRedo })}`)
      }
      if (typeof helpers.capture === 'function') await helpers.capture('redo')
      process.stdout.write(`  GPU 连续画笔：${JSON.stringify({
        samples: 100,
        uploadDelta,
        uploadCountBefore: initial.uploadCount,
        uploadCountAfter: afterStroke.uploadCount,
        undoUploadCount: afterUndo.uploadCount,
        redoUploadCount: afterRedo.uploadCount,
        diagnosticReadbackCount: afterRedo.readbackCount,
      })}\n`)
      const issues = await page.evaluate(async (afterTimestamp) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10),
          afterTimestamp,
          limit: 100,
        })
        return result.events.filter((event) => (
          event.level === 'error'
          || event.event === 'image_editor_v3.gpu_scene.tile_load_failed'
        ))
      }, importStartedAt)
      if (issues.length > 0) process.stdout.write(`  GPU 画笔问题诊断：${JSON.stringify(issues)}\n`)
      await settlePage(page, 500)
    },
  }]
}

module.exports = { createGpuBrushScenes }
