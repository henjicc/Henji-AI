function createGpuRasterScenes(context) {
  const { settlePage, clickNamedButton, setupToolbox } = context

  return [{
    id: 'image-editor-gpu-raster-diagnostic',
    surface: '工具箱',
    name: '图片编辑器-GPU基础栅格诊断',
    writesUserData: true,
    setup: async (page) => {
      const startedAt = new Date().toISOString()
      const waitForLogEvent = async (domainPrefix, accept, message, afterTimestamp = startedAt) => {
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const result = await page.evaluate(async ({ afterTimestamp, domain }) => (
            window.henjiNative.logging.queryLogEvents({
              date: new Date().toISOString().slice(0, 10),
              afterTimestamp,
              domainPrefix: domain,
              limit: 500,
            })
          ), { afterTimestamp, domain: domainPrefix })
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
          && Number(event.context?.surfaceFrameCount) > 0
          && Number(event.context?.imageBitmapFrameCount) === 0
          && Number(event.context?.directSurfaceFailureCount) === 0
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
        || Number(latest?.context?.diagnosticReadbackCount) !== 0
        || Number(latest?.context?.imageBitmapFrameCount) !== 0
        || Number(latest?.context?.directSurfaceFailureCount) !== 0) {
        throw new Error(`GPU 8192 帧没有切换mip、复用Pipeline或保持有界atlas：${JSON.stringify(frames)}`)
      }
      const recoveryStartedAt = new Date().toISOString()
      await page.evaluate(() => window.dispatchEvent(new CustomEvent(
        'henji:image-editor-gpu-scene-diagnostic',
        { detail: { recovery: 'success' } },
      )))
      await waitForLogEvent(
        'features.image_edit.v3.gpu_scene',
        (event) => event.event === 'image_editor_v3.gpu_scene.device_lost',
        'Reality注入device lost未触发',
        recoveryStartedAt,
      )
      await waitForLogEvent(
        'features.image_edit.v3.gpu_scene',
        (event) => event.event === 'image_editor_v3.gpu_scene.initialize.completed'
          && event.context?.recovered === true,
        'GPU device lost后未完成单次恢复',
        recoveryStartedAt,
      )
      const recoveredFrame = await waitForLogEvent(
        'features.image_edit.v3.gpu_scene_bridge',
        (event) => event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready'
          && Number(event.context?.surfaceFrameCount) > 0
          && Number(event.context?.imageBitmapFrameCount) === 0
          && Number(event.context?.diagnosticReadbackCount) === 0,
        'GPU恢复后没有重新直接呈现最新Surface帧',
        recoveryStartedAt,
      )
      const recoveredUi = await editor.evaluate((root) => {
        const preview = root.querySelector('[data-preview-surface]')
        const gpu = root.querySelector('[data-presentation-gpu-surface]')
        return {
          backend: preview?.getAttribute('data-preview-presentation-backend'),
          gpuVisibility: gpu instanceof HTMLElement ? getComputedStyle(gpu).visibility : null,
        }
      })
      if (recoveredUi.backend !== 'webgpu-surface' || recoveredUi.gpuVisibility !== 'visible') {
        throw new Error(`GPU恢复后未原子切回直接Surface：${JSON.stringify(recoveredUi)}`)
      }

      const failedRecoveryStartedAt = new Date().toISOString()
      await page.evaluate(() => window.dispatchEvent(new CustomEvent(
        'henji:image-editor-gpu-scene-diagnostic',
        { detail: { recovery: 'failure' } },
      )))
      await waitForLogEvent(
        'features.image_edit.v3.gpu_scene_bridge',
        (event) => event.event === 'image_editor_v3.gpu_scene.fallback'
          && event.context?.deviceStatus === 'lost',
        '第二次device lost未立即切换稳定CPU后备',
        failedRecoveryStartedAt,
      )
      await waitForLogEvent(
        'features.image_edit.v3.gpu_scene',
        (event) => event.event === 'image_editor_v3.gpu_scene.failed',
        'Reality恢复失败注入未进入有界fallback',
        failedRecoveryStartedAt,
      )
      await page.waitForTimeout(1200)
      const failedRecoveryUi = await editor.evaluate((root) => {
        const preview = root.querySelector('[data-preview-surface]')
        const gpu = root.querySelector('[data-presentation-gpu-surface]')
        return {
          backend: preview?.getAttribute('data-preview-presentation-backend'),
          gpuVisibility: gpu instanceof HTMLElement ? getComputedStyle(gpu).visibility : null,
          internalText: /device|backend|revision|surface|worker|gpu/i.test(root.textContent ?? ''),
        }
      })
      const repeatedRecovery = await page.evaluate(async ({ afterTimestamp }) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10),
          afterTimestamp,
          domainPrefix: 'features.image_edit.v3.gpu_scene',
          limit: 200,
        })
        return result.events.filter((event) => (
          event.event === 'image_editor_v3.gpu_scene.initialize.completed'
          && event.context?.recovered === true
        )).length
      }, { afterTimestamp: failedRecoveryStartedAt })
      if (failedRecoveryUi.backend !== 'canvas2d'
        || failedRecoveryUi.gpuVisibility !== 'hidden'
        || failedRecoveryUi.internalText
        || repeatedRecovery !== 0) {
        throw new Error(`GPU恢复失败没有稳定停在CPU或发生重试风暴：${JSON.stringify({ failedRecoveryUi, repeatedRecovery })}`)
      }
      process.stdout.write(`  GPU 8192瓦片隐藏帧：${JSON.stringify({
        initial: initial?.context,
        latest: latest.context,
        recovered: recoveredFrame.context,
      })}\n`)
      await settlePage(page, 600)
    },
  }, {
    id: 'image-editor-gpu-initialization-fallback',
    surface: '工具箱',
    name: '图片编辑器-GPU初始化失败回退',
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
      const importTarget = await editor.isVisible() ? editor : dropTarget
      await importTarget.evaluate(async (element) => {
        const canvas = document.createElement('canvas')
        canvas.width = 640
        canvas.height = 480
        const context = canvas.getContext('2d')
        if (!context) throw new Error('初始化失败夹具画布不可用')
        context.fillStyle = 'rgb(37, 99, 235)'
        context.fillRect(0, 0, 640, 480)
        context.fillStyle = 'rgb(244, 114, 182)'
        context.fillRect(160, 100, 320, 280)
        const blob = await new Promise((resolve, reject) => canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('初始化失败夹具编码失败')),
          'image/png',
        ))
        const transfer = new DataTransfer()
        transfer.items.add(new File([blob], 'gpu-init-fallback.png', { type: 'image/png' }))
        element.dispatchEvent(new DragEvent('drop', {
          bubbles: true, cancelable: true, dataTransfer: transfer,
        }))
      })
      await editor.waitFor({ state: 'visible', timeout: 60000 })
      let initialization = null
      const initializationDeadline = Date.now() + 30000
      while (!initialization && Date.now() < initializationDeadline) {
        initialization = await page.evaluate(async ({ afterTimestamp }) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            domainPrefix: 'features.image_edit.v3.gpu_scene',
            limit: 500,
          })
          const failure = result.events
            .filter((event) => event.event === 'image_editor_v3.gpu_scene.failed')
            .reduce((latest, event) => (
              !latest || String(event.timestamp) > String(latest.timestamp) ? event : latest
            ), null)
          if (!failure) return null
          const sessionEvents = result.events.filter(
            (event) => event.context?.sessionId === failure.context?.sessionId,
          )
          return {
            acquireCount: Number(failure?.context?.diagnosticDeviceAcquireCount ?? -1),
            completedCount: sessionEvents.filter(
              (event) => event.event === 'image_editor_v3.gpu_scene.initialize.completed',
            ).length,
            failedCount: sessionEvents.filter(
              (event) => event.event === 'image_editor_v3.gpu_scene.failed',
            ).length,
            startedCount: sessionEvents.filter(
              (event) => event.event === 'image_editor_v3.gpu_scene.initialize.start',
            ).length,
            surfaceFrameCount: Number(failure?.context?.diagnosticSurfaceFrameCount ?? -1),
            visibleSurfaceFrameCount: result.events.filter(
              (event) => event.event === 'image_editor_v3.gpu_scene.hidden_frame_ready',
            ).length,
          }
        }, { afterTimestamp: startedAt })
        if (!initialization) await page.waitForTimeout(100)
      }
      if (!initialization) throw new Error('等待首次 GPU 初始化失败日志超时')
      if (initialization.startedCount !== 1
        || initialization.failedCount !== 1
        || initialization.completedCount !== 0
        || initialization.acquireCount !== 0
        || initialization.surfaceFrameCount !== 0
        || initialization.visibleSurfaceFrameCount !== 0) {
        throw new Error(`GPU初始化失败没有在首次设备申请与Surface帧前发生：${JSON.stringify(initialization)}`)
      }
      const preview = editor.locator('[data-preview-surface]')
      await page.waitForFunction(() => {
        const preview = document.querySelector('[data-image-editor-v3] [data-preview-surface]')
        return preview?.getAttribute('data-preview-presentation-backend') === 'canvas2d'
          && Number(preview.getAttribute('data-preview-coverage') ?? '0') > 0
      }, undefined, { timeout: 60000 })
      const duplicate = editor.getByRole('button', { name: /^(复制图层|Duplicate layer)$/i })
      await duplicate.click()
      await page.waitForFunction(() => (
        document.querySelectorAll('[data-image-editor-v3] [role="treeitem"][data-layer-type="raster"]').length === 2
      ), undefined, { timeout: 10000 })
      await page.waitForFunction(async ({ afterTimestamp }) => {
        const result = await window.henjiNative.logging.queryLogEvents({
          date: new Date().toISOString().slice(0, 10), afterTimestamp, level: 'info', limit: 300,
        })
        return result.events.some((event) => event.event === 'image_editor_v3.document.save.completed')
      }, { afterTimestamp: startedAt }, { timeout: 12000 })
      const previewBox = await preview.boundingBox()
      if (!previewBox) throw new Error('初始化失败回退无法读取预览区域')
      await editor.locator('[data-tool-id="hand"]').click()
      await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(previewBox.x + previewBox.width / 2 + 80, previewBox.y + previewBox.height / 2 + 40)
      await page.mouse.up()
      const ui = await editor.evaluate((root) => ({
        internalText: /device|backend|revision|surface|worker|gpu/i.test(root.textContent ?? ''),
        gpuVisibility: getComputedStyle(root.querySelector('[data-presentation-gpu-surface]')).visibility,
      }))
      if (ui.internalText || ui.gpuVisibility !== 'hidden') {
        throw new Error(`GPU初始化失败泄露内部状态或遮挡CPU稳定帧：${JSON.stringify(ui)}`)
      }
      process.stdout.write(`  GPU首次初始化失败：${JSON.stringify(initialization)}\n`)
      await settlePage(page, 600)
    },
  }]
}

module.exports = { createGpuRasterScenes }
