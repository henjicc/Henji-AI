const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

function createGpuExportScenes(context) {
  const { settlePage } = context

  return [{
    id: 'image-editor-gpu-export',
    surface: '画布',
    name: '画布节点-图片编辑器分块导出',
    writesUserData: true,
    setup: async (page, _app, inspection) => {
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

      const { dialog, editor } = await openCanvasImageEditorV3Fixture({
        page, context, width: 1600, height: 1000, label: '分块导出文档',
      })
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
      await inspection?.capture?.('editor')
    },
  }, {
    id: 'image-editor-gpu-export-transactional-fallback',
    surface: '画布',
    name: '画布节点-图片编辑器导出原子回退',
    writesUserData: true,
    setup: async (page, _app, inspection) => {
      const startedAt = new Date().toISOString()
      const { dialog, editor, fixture } = await openCanvasImageEditorV3Fixture({
        page, context, width: 1024, height: 640, label: '导出故障重试文档',
      })
      const node = page.locator(`[data-layer-stack-node-id="${fixture.nodeId}"]`)
      const initialPreview = await node.locator('img[alt="多图层图片预览"]').getAttribute('src')
      await page.waitForFunction(() => (
        document.querySelector('[data-preview-surface]')
          ?.getAttribute('data-preview-presentation-backend') === 'webgpu-surface'
      ), undefined, { timeout: 30000 })

      await page.evaluate(() => window.dispatchEvent(new CustomEvent(
        'henji:image-editor-gpu-scene-diagnostic',
        { detail: { failNextExportAfterTiles: 1 } },
      )))
      await editor.getByRole('button', {
        name: /隐藏.*导出故障重试文档|Hide.*export retry document/i,
      }).click()
      await editor.getByRole('button', {
        name: /显示.*导出故障重试文档|Show.*export retry document/i,
      }).click()
      await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 60000 })

      const deadline = Date.now() + 60000
      let evidence = null
      while (!evidence && Date.now() < deadline) {
        evidence = await page.evaluate(async ({ afterTimestamp }) => {
          const result = await window.henjiNative.logging.queryLogEvents({
            date: new Date().toISOString().slice(0, 10),
            afterTimestamp,
            limit: 500,
          })
          const failures = result.events.filter((event) => (
            event.event === 'image_editor_v3.gpu_export.failed'
            && Number(event.context?.completedTiles) === 1
          ))
          const retryRequests = result.events.filter((event) => (
            event.event === 'image_editor_v3.gpu_export.cpu_retry_requested'
          ))
          const backendRetries = result.events.filter((event) => (
            event.event === 'image_editor_v3.raster_export.backend_retry'
          ))
          const starts = result.events.filter((event) => (
            event.event === 'image_editor_v3.raster_export.session.started'
          ))
          const discarded = result.events.filter((event) => (
            event.event === 'image_editor_v3.raster_export.session.cancelled'
            && event.context?.reason === 'render_backend_retry'
          ))
          const published = result.events.filter((event) => (
            event.event === 'image_editor_v3.managed_raster.completed'
          ))
          if (failures.length !== 1 || retryRequests.length !== 1
            || backendRetries.length !== 1 || starts.length !== 2
            || discarded.length !== 1 || published.length !== 1) return null
          return {
            failedTiles: failures[0]?.context?.completedTiles,
            retryCount: backendRetries.length,
            sessionIds: starts.map((event) => event.requestId),
            discardedSessionId: discarded[0]?.requestId,
            publishedSessionId: published[0]?.requestId,
          }
        }, { afterTimestamp: startedAt })
        if (!evidence) await page.waitForTimeout(100)
      }
      if (!evidence
        || evidence.sessionIds.length !== 2
        || evidence.sessionIds[0] === evidence.sessionIds[1]
        || evidence.discardedSessionId === evidence.publishedSessionId
        || !evidence.sessionIds.includes(evidence.discardedSessionId)
        || !evidence.sessionIds.includes(evidence.publishedSessionId)) {
        throw new Error(`GPU导出失败后没有原子重启完整CPU会话：${JSON.stringify(evidence)}`)
      }

      await page.waitForFunction(({ selector, previous }) => {
        const image = document.querySelector(`${selector} img[alt="多图层图片预览"]`)
        return image instanceof HTMLImageElement && image.getAttribute('src') !== previous
      }, {
        selector: `[data-layer-stack-node-id="${fixture.nodeId}"]`,
        previous: initialPreview,
      }, { timeout: 30000 })
      process.stdout.write(`  GPU导出原子CPU重启：${JSON.stringify(evidence)}\n`)
      await settlePage(page, 600)
      await inspection?.capture?.('canvas')
    },
  }]
}

module.exports = { createGpuExportScenes }
