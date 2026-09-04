function createGpuExportScenes(context) {
  const { settlePage, clickNamedButton, setupToolbox } = context

  return [{
    id: 'image-editor-gpu-export',
    surface: '工具箱',
    name: '图片编辑器-GPU分块导出',
    writesUserData: true,
    setup: async (page) => {
      const startedAt = new Date().toISOString()
      const waitForLogEvent = async (domainPrefix, accept, message, afterTimestamp = startedAt) => {
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const result = await page.evaluate(async ({ timestamp, domain }) => (
            window.henjiNative.logging.queryLogEvents({
              date: new Date().toISOString().slice(0, 10),
              afterTimestamp: timestamp,
              domainPrefix: domain,
              limit: 500,
            })
          ), { timestamp: afterTimestamp, domain: domainPrefix })
          const event = result.events.find(accept)
          if (event) return event
          await page.waitForTimeout(100)
        }
        throw new Error(message)
      }

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
        canvas.width = 1600
        canvas.height = 1000
        const drawing = canvas.getContext('2d')
        if (!drawing) throw new Error('GPU 导出 Reality 夹具画布不可用')
        const gradient = drawing.createLinearGradient(0, 0, canvas.width, canvas.height)
        gradient.addColorStop(0, 'rgb(14, 116, 144)')
        gradient.addColorStop(0.5, 'rgb(124, 58, 237)')
        gradient.addColorStop(1, 'rgb(244, 63, 94)')
        drawing.fillStyle = gradient
        drawing.fillRect(0, 0, canvas.width, canvas.height)
        drawing.fillStyle = 'rgba(255, 255, 255, 0.72)'
        drawing.beginPath()
        drawing.arc(520, 500, 260, 0, Math.PI * 2)
        drawing.fill()
        drawing.fillStyle = 'rgba(15, 23, 42, 0.68)'
        drawing.fillRect(920, 180, 430, 640)
        const blob = await new Promise((resolve, reject) => canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('GPU 导出 Reality 夹具编码失败')),
          'image/png',
        ))
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], 'gpu-export-1600x1000.png', { type: 'image/png' }))
        element.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }))
      })
      if (previousEditor) {
        await page.waitForFunction((element) => !element.isConnected, previousEditor, { timeout: 60000 })
      }
      const bootstrap = await waitForLogEvent(
        'features.imageMark.v3_host',
        (event) => event.event === 'image_editor_v3.toolbox.bootstrap.completed'
          || event.event === 'image_editor_v3.toolbox.bootstrap.failed',
        '等待 GPU 导出 Reality 源导入日志超时',
      )
      if (bootstrap.event === 'image_editor_v3.toolbox.bootstrap.failed') {
        throw new Error(`GPU 导出 Reality 源导入失败：${JSON.stringify(bootstrap)}`)
      }
      await editor.waitFor({ state: 'visible', timeout: 60000 })
      const initialFrame = await waitForLogEvent(
        'features.image_edit.v3.gpu_scene_bridge',
        (event) => event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
          && Number(event.context?.surfaceFrameCount) > 0
          && Number(event.context?.residentTileCount) > 0
          && Number(event.context?.diagnosticReadbackCount) === 0
          && Number(event.context?.imageBitmapFrameCount) === 0,
        '等待 GPU 导出 Reality 直接 Surface 初帧超时',
      )

      const exportStartedAt = new Date().toISOString()
      await page.evaluate(() => window.dispatchEvent(new CustomEvent(
        'henji:image-editor-gpu-scene-diagnostic',
        { detail: { exportProbe: true } },
      )))
      const exportStarted = await waitForLogEvent(
        'features.image_edit.v3.gpu_export',
        (event) => event.event === 'image_editor_v3.gpu_export.started',
        'GPU 分块导出探针没有启动',
        exportStartedAt,
      )

      const preview = editor.locator('[data-preview-surface]')
      const previewBox = await preview.boundingBox()
      if (!previewBox) throw new Error('GPU 分块导出探针无法读取预览区域')
      await editor.locator('[data-tool-id="hand"]').click()
      await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(
        previewBox.x + previewBox.width / 2 - 120,
        previewBox.y + previewBox.height / 2 - 60,
        { steps: 8 },
      )
      await page.mouse.up()
      const concurrentFrame = await waitForLogEvent(
        'features.image_edit.v3.gpu_scene_bridge',
        (event) => event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
          && Number(event.context?.frameCount) > Number(initialFrame.context?.frameCount)
          && Number(event.context?.surfaceFrameCount) > Number(initialFrame.context?.surfaceFrameCount)
          && Number(event.context?.diagnosticReadbackCount) === 0
          && Number(event.context?.imageBitmapFrameCount) === 0,
        'GPU 导出期间拖动没有继续产生零 readback Surface 帧',
        exportStarted.timestamp,
      )
      const completed = await waitForLogEvent(
        'features.image_edit.v3.gpu_export',
        (event) => event.event === 'image_editor_v3.gpu_export.completed',
        'GPU 分块导出探针没有完成',
        exportStarted.timestamp,
      )

      const tileCount = Math.ceil(1600 / 512) * Math.ceil(1000 / 512)
      if (Number(completed.context?.completedTiles) !== tileCount
        || Number(completed.context?.readbackCount) !== tileCount
        || Number(completed.context?.maximumTargetWidth) > 1024
        || Number(completed.context?.maximumTargetHeight) > 1024
        || Number(completed.context?.previewResidentBytes) <= 0
        || Number(completed.context?.sharedResidentBytes) > 256 * 1024 * 1024
        || String(concurrentFrame.timestamp) >= String(completed.timestamp)) {
        throw new Error(`GPU 分块导出 Reality 指标不满足合同：${JSON.stringify({
          completed: completed.context,
          concurrentFrame: concurrentFrame.context,
        })}`)
      }
      const ui = await editor.evaluate((root) => ({
        backend: root.querySelector('[data-preview-surface]')
          ?.getAttribute('data-preview-presentation-backend'),
        gpuVisibility: getComputedStyle(
          root.querySelector('[data-presentation-gpu-surface]'),
        ).visibility,
      }))
      if (ui.backend !== 'webgpu-surface' || ui.gpuVisibility !== 'visible') {
        throw new Error(`GPU 分块导出完成后预览没有保持 Surface：${JSON.stringify(ui)}`)
      }
      process.stdout.write(`  GPU分块导出：${JSON.stringify({
        export: completed.context,
        initialSurfaceFrames: initialFrame.context?.surfaceFrameCount,
        concurrentSurfaceFrames: concurrentFrame.context?.surfaceFrameCount,
        previewBackend: ui.backend,
      })}\n`)
      await settlePage(page, 600)
    },
  }]
}

module.exports = { createGpuExportScenes }
