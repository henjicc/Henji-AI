function createGpuRasterScenes(context) {
  const { settlePage, clickNamedButton, setupToolbox } = context

  return [{
    id: 'image-editor-gpu-raster-diagnostic',
    surface: '工具箱',
    name: '图片编辑器-GPU基础栅格诊断',
    writesUserData: true,
    setup: async (page) => {
      const startedAt = new Date().toISOString()
      const waitForLogEvent = async (domainPrefix, accept, message) => {
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const result = await page.evaluate(async ({ afterTimestamp, domain }) => (
            window.henjiNative.logging.queryLogEvents({
              date: new Date().toISOString().slice(0, 10),
              afterTimestamp,
              domainPrefix: domain,
              limit: 500,
            })
          ), { afterTimestamp: startedAt, domain: domainPrefix })
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
        canvas.width = 8192
        canvas.height = 8192
        const context = canvas.getContext('2d')
        if (!context) throw new Error('GPU 基础栅格夹具画布不可用')
        context.fillStyle = 'rgb(24, 86, 214)'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.fillStyle = 'rgb(231, 76, 122)'
        context.fillRect(2048, 0, 2048, canvas.height)
        context.fillStyle = 'rgb(248, 193, 62)'
        context.fillRect(6144, 0, 2048, canvas.height)
        context.fillStyle = 'rgba(255, 255, 255, 0.68)'
        context.beginPath()
        context.arc(2867, 3959, 1587, 0, Math.PI * 2)
        context.fill()
        context.fillStyle = 'rgba(12, 22, 45, 0.82)'
        context.fillRect(4608, 1382, 2458, 3379)
        const blob = await new Promise((resolve, reject) => canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('GPU 基础栅格夹具编码失败')),
          'image/png',
        ))
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], 'gpu-raster-8192.png', { type: 'image/png' }))
        element.dispatchEvent(new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }))
      })

      if (previousEditor) {
        await page.waitForFunction((element) => !element.isConnected, previousEditor, {
          timeout: 60000,
        })
      }
      const bootstrapEvent = await waitForLogEvent(
        'features.imageMark.v3_host',
        (event) => (
          event.event === 'image_editor_v3.toolbox.bootstrap.completed'
          || event.event === 'image_editor_v3.toolbox.bootstrap.failed'
        ),
        '等待8192源导入日志超时',
      )
      if (bootstrapEvent?.event === 'image_editor_v3.toolbox.bootstrap.failed') {
        throw new Error(`8192源导入失败：${JSON.stringify(bootstrapEvent)}`)
      }
      await editor.waitFor({ state: 'visible', timeout: 60000 })
      const duplicate = editor.getByRole('button', { name: /^(复制图层|Duplicate layer)$/i })
      await duplicate.waitFor({ state: 'visible', timeout: 8000 })
      for (let index = 0; index < 4; index += 1) {
        await duplicate.click()
        await page.waitForTimeout(120)
      }
      await page.waitForFunction(() => (
        document.querySelectorAll('[data-image-editor-v3] [role="treeitem"][data-layer-type="raster"]').length === 5
      ), undefined, { timeout: 8000 })

      const gpuReadyEvent = await waitForLogEvent(
        'features.image_edit.v3.gpu_scene_bridge',
        (event) => (
          event.event === 'image_editor_v3.gpu_scene.tile_load_failed'
          || (
          event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
          && Number(event.context?.residentTileCount) > 0
          && Number(event.context?.atlasPageCount) > 0
          && Number(event.context?.allocatedAtlasBytes) < 8192 * 8192 * 4
          && Number(event.context?.pipelineCompileCount) === 2
          && Number(event.context?.diagnosticReadbackCount) === 0
          )
        ),
        '等待8192 GPU初帧日志超时',
      )
      if (gpuReadyEvent?.event === 'image_editor_v3.gpu_scene.tile_load_failed') {
        throw new Error(`8192 GPU瓦片读取失败：${JSON.stringify(gpuReadyEvent)}`)
      }

      const preview = editor.locator('[data-preview-surface]')
      const previewBox = await preview.boundingBox()
      if (!previewBox) throw new Error('GPU 基础栅格诊断无法读取预览区域')
      const initial = gpuReadyEvent
      await editor.locator('[data-tool-id="zoom"]').click()
      await page.mouse.move(
        previewBox.x + previewBox.width / 2 - 180,
        previewBox.y + previewBox.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(
        previewBox.x + previewBox.width / 2 + 180,
        previewBox.y + previewBox.height / 2,
        { steps: 12 },
      )
      await page.mouse.up()
      const zoomFrameEvent = await waitForLogEvent(
        'features.image_edit.v3.gpu_scene_bridge',
        (event) => (
          event.event === 'image_editor_v3.gpu_scene.tile_load_failed'
          || (event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
        && Number(event.context?.frameCount) > Number(initial?.context?.frameCount)
        && Number(event.context?.minimumPlannedMip) !== Number(initial?.context?.minimumPlannedMip))
        ),
        '等待8192缩放mip切换日志超时',
      )
      if (zoomFrameEvent?.event === 'image_editor_v3.gpu_scene.tile_load_failed') {
        throw new Error(`8192缩放瓦片读取失败：${JSON.stringify(zoomFrameEvent)}`)
      }
      await editor.locator('[data-tool-id="hand"]').click()
      await page.mouse.move(
        previewBox.x + previewBox.width / 2,
        previewBox.y + previewBox.height / 2,
      )
      await page.mouse.down()
      await page.mouse.move(
        previewBox.x + previewBox.width / 2 - 240,
        previewBox.y + previewBox.height / 2 - 120,
        { steps: 10 },
      )
      await page.mouse.up()
      const panFrameEvent = await waitForLogEvent(
        'features.image_edit.v3.gpu_scene_bridge',
        (event) => (
          event.event === 'image_editor_v3.gpu_scene.tile_load_failed'
          || (event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
          && Number(event.context?.frameCount) > Number(zoomFrameEvent?.context?.frameCount)
          )
        ),
        '等待8192平移帧日志超时',
      )
      if (panFrameEvent?.event === 'image_editor_v3.gpu_scene.tile_load_failed') {
        throw new Error(`8192平移瓦片读取失败：${JSON.stringify(panFrameEvent)}`)
      }
      const frames = [initial, zoomFrameEvent, panFrameEvent].filter(Boolean)
      const latest = frames.reduce((newest, event) => (
        Number(event.context?.frameCount) > Number(newest?.context?.frameCount ?? -1)
          ? event
          : newest
      ), null)
      if (frames.length < 2
        || Number(latest?.context?.residentTileCount) < 1
        || Number(latest?.context?.atlasPageCount) < 1
        || Number(latest?.context?.allocatedAtlasBytes) >= 8192 * 8192 * 4
        || Number(latest?.context?.allocatedAtlasBytes) > 256 * 1024 * 1024
        || Number(latest?.context?.pipelineCompileCount) !== 2
        || Number(latest?.context?.frameCount) <= Number(zoomFrameEvent?.context?.frameCount)
        || Number(latest?.context?.minimumPlannedMip) === Number(initial?.context?.minimumPlannedMip)
        || Number(latest?.context?.diagnosticReadbackCount) !== 0) {
        throw new Error(`GPU 8192 帧没有切换mip、复用Pipeline或保持有界atlas：${JSON.stringify(frames)}`)
      }
      process.stdout.write(`  GPU 8192瓦片隐藏帧：${JSON.stringify({
        initial: initial?.context,
        latest: latest.context,
      })}\n`)
      await settlePage(page, 600)
    },
  }]
}

module.exports = { createGpuRasterScenes }
