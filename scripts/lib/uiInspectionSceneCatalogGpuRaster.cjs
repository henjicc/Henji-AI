function createGpuRasterScenes(context) {
  const { settlePage, clickNamedButton, setupToolbox } = context

  return [{
    id: 'image-editor-gpu-raster-diagnostic',
    surface: '工具箱',
    name: '图片编辑器-GPU基础栅格诊断',
    writesUserData: true,
    setup: async (page) => {
      const startedAt = new Date().toISOString()
      await setupToolbox(page)
      await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
      const host = page.locator('[data-application-surface-id="tool.image_edit"]:visible')
      await host.waitFor({ state: 'visible', timeout: 12000 })
      const dropTarget = host.locator('.border-dashed').first()
      const editor = host.locator('[data-image-editor-v3]')
      await Promise.race([
        dropTarget.waitFor({ state: 'visible', timeout: 12000 }),
        editor.waitFor({ state: 'visible', timeout: 12000 }),
      ])
      const previousEditor = await editor.isVisible() ? await editor.elementHandle() : null
      const importTarget = previousEditor ? editor : dropTarget
      await importTarget.evaluate(async (element) => {
        const canvas = document.createElement('canvas')
        canvas.width = 320
        canvas.height = 240
        const context = canvas.getContext('2d')
        if (!context) throw new Error('GPU 基础栅格夹具画布不可用')
        const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height)
        gradient.addColorStop(0, 'rgb(24, 86, 214)')
        gradient.addColorStop(0.5, 'rgb(231, 76, 122)')
        gradient.addColorStop(1, 'rgb(248, 193, 62)')
        context.fillStyle = gradient
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = 'rgba(255, 255, 255, 0.68)'
        context.beginPath()
        context.arc(112, 116, 62, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = 'rgba(12, 22, 45, 0.82)'
        context.fillRect(180, 54, 96, 132)
        const blob = await new Promise((resolve, reject) => canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('GPU 基础栅格夹具编码失败')),
          'image/png',
        ))
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], 'gpu-raster-diagnostic.png', { type: 'image/png' }))
        element.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }))
      })

      if (previousEditor) {
        await page.waitForFunction((element) => !element.isConnected, previousEditor, {
          timeout: 15000,
        })
      }
      await editor.waitFor({ state: 'visible', timeout: 15000 })
      const duplicate = editor.getByRole('button', { name: /^(复制图层|Duplicate layer)$/i })
      await duplicate.waitFor({ state: 'visible', timeout: 8000 })
      for (let index = 0; index < 4; index += 1) {
        await duplicate.click()
        await page.waitForTimeout(120)
      }
      await page.waitForFunction(() => (
        document.querySelectorAll('[data-image-editor-v3] [role="treeitem"][data-layer-type="raster"]').length === 5
      ), undefined, { timeout: 8000 })

      const readHiddenFrames = async () => page.evaluate(async (afterTimestamp) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10),
          afterTimestamp,
          level: 'info',
          limit: 200,
        })
        return result.events.filter((event) => (
          event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
        ))
      }, startedAt)
      await page.waitForFunction(async (afterTimestamp) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10),
          afterTimestamp,
          level: 'info',
          limit: 200,
        })
        return result.events.some((event) => (
          event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
          && Number(event.context?.uploadCount) === 1
          && Number(event.context?.pipelineCompileCount) === 2
          && Number(event.context?.diagnosticReadbackCount) === 0
        ))
      }, startedAt, { timeout: 20000 })

      const preview = editor.locator('[data-preview-surface]')
      const previewBox = await preview.boundingBox()
      if (!previewBox) throw new Error('GPU 基础栅格诊断无法读取预览区域')
      await editor.locator('[data-tool-id="zoom"]').click()
      await page.mouse.move(
        previewBox.x + previewBox.width / 2,
        previewBox.y + previewBox.height / 2,
      )
      await page.mouse.wheel(0, -1)
      await page.waitForTimeout(700)
      const frames = await readHiddenFrames()
      const latest = frames.reduce((newest, event) => (
        Number(event.context?.frameCount) > Number(newest?.context?.frameCount ?? -1)
          ? event
          : newest
      ), null)
      if (frames.length < 2
        || Number(latest?.context?.uploadCount) !== 1
        || Number(latest?.context?.pipelineCompileCount) !== 2
        || Number(latest?.context?.frameCount) < 2
        || Number(latest?.context?.diagnosticReadbackCount) !== 0) {
        throw new Error(`GPU 隐藏帧没有复用纹理/Pipeline或发生回读：${JSON.stringify(frames)}`)
      }
      process.stdout.write(`  GPU基础栅格隐藏帧：${JSON.stringify(latest.context)}\n`)
      await settlePage(page, 600)
    },
  }]
}

module.exports = { createGpuRasterScenes }
