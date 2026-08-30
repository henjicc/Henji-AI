function attachUiInspectionCanvasPanorama(context) {
  const {
    settlePage,
    diffBuffers,
    setupCanvasPanoramaToolbar,
  } = context

  async function setupCanvasPanoramaViewer(page) {
    const { generatedNodeId, projectId } = await setupCanvasPanoramaToolbar(page)
    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    await page.evaluate(async (payload) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [payload.projectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]').map((node) => {
        if (node.id !== '__ui_panorama_result') return node
        const { height: _height, measured: _measured, ...rest } = node
        return {
          ...rest,
          type: 'panoramaViewerNode',
          hidden: false,
          width: 448,
          style: { width: 448 },
          data: {
            ...node.data,
            displayName: '全景查看',
            resultKind: 'panorama',
            viewMode: 'sphere',
            viewportAspectRatio: '16:9',
            cameraView: { yaw: 0, pitch: 0, fov: 70 },
          },
        }
      })
      const primary = nodes.find((node) => node.id === '__ui_panorama_result')
      if (!primary) throw new Error('全景节点场景缺少专用结果 fixture')
      if (!nodes.some((node) => node.id === '__ui_panorama_result_secondary')) {
        nodes.push({
          ...primary,
          id: '__ui_panorama_result_secondary',
          hidden: false,
          position: { x: 2060, y: 900 },
          data: { ...primary.data, displayName: '全景查看·次节点' },
        })
      }
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET nodes_json = ?, viewport_json = ? WHERE id = ?',
        [JSON.stringify(nodes), JSON.stringify({ x: -920, y: -510, zoom: 0.82 }), payload.projectId]
      )
    }, { projectId })
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const resultNode = page.locator('.react-flow__node[data-id="__ui_panorama_result"]')
    const secondaryResultNode = page.locator('.react-flow__node[data-id="__ui_panorama_result_secondary"]')
    await resultNode.waitFor({ state: 'visible', timeout: 12000 })
    await secondaryResultNode.waitFor({ state: 'visible', timeout: 12000 })
    const inlineViewer = resultNode.locator('[data-panorama-viewer-node-id="__ui_panorama_result"]')
    const secondaryInlineViewer = secondaryResultNode.locator('[data-panorama-viewer-node-id="__ui_panorama_result_secondary"]')
    await inlineViewer.waitFor({ state: 'visible', timeout: 12000 })
    await secondaryInlineViewer.waitFor({ state: 'visible', timeout: 12000 })

    // 选中时只保留通用工具条，全景派生能力和“更多”不能重复出现。
    await resultNode.click({ position: { x: 20, y: 20 } })
    await page.waitForTimeout(320)
    if (await page.locator('[data-image-capability-more="true"]:visible').count()) {
      throw new Error('全景查看节点顶部仍显示图片能力“更多”')
    }
    if (await page.locator('[data-image-capability-id]:visible').count()) {
      throw new Error('全景查看节点顶部仍重复显示图片派生能力')
    }

    const activeInlineCanvases = page.locator(
      '[data-panorama-inline-surface] [data-panorama-surface="sphere"] canvas'
    )
    const primarySurface = inlineViewer.locator('[data-panorama-inline-surface]')
    const secondarySurface = secondaryInlineViewer.locator('[data-panorama-inline-surface]')
    const waitForPanoramaCanvas = async (canvas, stage) => {
      try {
        await canvas.waitFor({ state: 'visible', timeout: 12000 })
      } catch (error) {
        throw new Error(`全景 Canvas 未就绪（${stage}）：${error.message}`)
      }
    }
    const screenshotPrimarySurface = async () => {
      const box = await primarySurface.boundingBox()
      if (!box) throw new Error('全景节点预览区域不可见')
      return await page.screenshot({ animations: 'disabled', clip: box })
    }
    const initialPreview = primarySurface.locator('img[data-panorama-frozen-preview="true"]')
    await initialPreview.waitFor({ state: 'visible', timeout: 12000 })
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-panorama-inline-surface] [data-panorama-surface="sphere"] canvas').length === 0
    ), undefined, { timeout: 8000 })
    const initialPreviewFrame = await screenshotPrimarySurface()
    await page.mouse.move(20, 80)
    await primarySurface.hover()
    const primarySphere = primarySurface.locator('[data-panorama-surface="sphere"] canvas')
    await waitForPanoramaCanvas(primarySphere, '初次指针激活')
    await primarySurface.locator('[data-panorama-transition-preview="true"]')
      .waitFor({ state: 'detached', timeout: 8000 })
    // 快速移出再移入必须复用同一个 WebGL 实例，不能先冻结再重建造成卡顿。
    await primarySphere.evaluate((canvas) => { canvas.dataset.realityPanoramaInstance = 'retained' })
    await page.mouse.move(20, 80)
    await page.waitForTimeout(80)
    await primarySurface.hover()
    await page.waitForTimeout(240)
    if (await primarySphere.getAttribute('data-reality-panorama-instance') !== 'retained') {
      throw new Error('快速移出再移入时错误重建了全景 WebGL 实例')
    }
    const initialSphereFrame = await screenshotPrimarySurface()
    const initialPreviewDiff = await diffBuffers(initialPreviewFrame, initialSphereFrame)
    if (initialPreviewDiff.changedPct > 1) {
      throw new Error(`全景结果初始预览不是默认球面视角：变化像素 ${initialPreviewDiff.changedPct}%`)
    }
    if (await activeInlineCanvases.count() > 1) throw new Error('全景节点内嵌 WebGL Canvas 超过 1 个')
    await secondarySurface.hover()
    await waitForPanoramaCanvas(
      secondarySurface.locator('[data-panorama-surface="sphere"] canvas'),
      '切换到次节点租约',
    )
    if (await activeInlineCanvases.count() > 1) throw new Error('租约切换后全景内嵌 Canvas 超过 1 个')
    await primarySurface.hover()
    await waitForPanoramaCanvas(primarySphere, '切回主节点租约')
    await primarySurface.locator('[data-panorama-transition-preview="true"]')
      .waitFor({ state: 'detached', timeout: 8000 })

    await page.waitForTimeout(240)
    const contextLossResult = await primarySphere.evaluate((canvas) => {
      const event = new WebGLContextEvent('webglcontextlost', {
        cancelable: true,
        statusMessage: 'Reality 主动模拟上下文丢失',
      })
      canvas.dispatchEvent(event)
      return { defaultPrevented: event.defaultPrevented }
    })
    if (!contextLossResult.defaultPrevented) throw new Error('WebGL context lost 事件未执行 preventDefault')
    await primarySphere.waitFor({ state: 'detached', timeout: 8000 })
    await primarySurface.locator('img').waitFor({ state: 'visible', timeout: 8000 })
    if (await activeInlineCanvases.count()) throw new Error('WebGL context lost 后仍保留内嵌 Canvas')
    await resultNode.getByRole('button', { name: /^(球面|Sphere)$/i }).click()
    await waitForPanoramaCanvas(primarySphere, 'WebGL 上下文丢失后恢复')
    await page.waitForTimeout(240)

    // 节点内第一次指针手势就直接环视，不得带动节点或 ReactFlow 视口。
    const nodeBoxBeforeDrag = await resultNode.boundingBox()
    const viewportTransformBeforeDrag = await page.locator('.react-flow__viewport').getAttribute('style')
    const inlineBox = await primarySphere.boundingBox()
    if (!nodeBoxBeforeDrag || !inlineBox) throw new Error('全景节点内没有可交互球面区域')
    await page.mouse.move(inlineBox.x + inlineBox.width * 0.45, inlineBox.y + inlineBox.height * 0.44)
    await page.mouse.down()
    await page.mouse.move(inlineBox.x + inlineBox.width * 0.62, inlineBox.y + inlineBox.height * 0.61, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(280)
    const nodeBoxAfterDrag = await resultNode.boundingBox()
    const viewportTransformAfterDrag = await page.locator('.react-flow__viewport').getAttribute('style')
    if (!nodeBoxAfterDrag
      || Math.abs(nodeBoxAfterDrag.x - nodeBoxBeforeDrag.x) > 1
      || Math.abs(nodeBoxAfterDrag.y - nodeBoxBeforeDrag.y) > 1) {
      throw new Error('节点内环视错误带动了节点位置')
    }
    if (viewportTransformAfterDrag !== viewportTransformBeforeDrag) {
      throw new Error('节点内环视错误带动了 ReactFlow 视口')
    }

    // 按住拖出节点后不得因移出超时释放 Canvas；外部松手后快速返回也必须继续复用原实例。
    await primarySphere.evaluate((canvas) => {
      canvas.dataset.realityPanoramaDragInstance = 'retained'
    })
    const dragOutsideBox = await primarySphere.boundingBox()
    if (!dragOutsideBox) throw new Error('全景节点拖出测试时球面区域不可见')
    const retainedDragInstanceExists = async () => await primarySphere.evaluateAll((canvases) => (
      canvases[0]?.dataset.realityPanoramaDragInstance === 'retained'
    ))
    await page.mouse.move(
      dragOutsideBox.x + dragOutsideBox.width * 0.5,
      dragOutsideBox.y + dragOutsideBox.height * 0.5,
    )
    await page.mouse.down()
    await page.mouse.move(20, 80, { steps: 12 })
    await page.waitForTimeout(620)
    if (!await retainedDragInstanceExists()) {
      throw new Error('按住拖出节点时错误释放了全景 WebGL 实例')
    }
    await page.mouse.up()
    await page.waitForTimeout(80)
    await primarySurface.hover()
    await page.waitForTimeout(560)
    if (!await retainedDragInstanceExists()) {
      throw new Error('拖出后在外部松手并快速返回时错误重建了全景 WebGL 实例')
    }

    // 指针移出后释放 WebGL，但节点必须冻结在刚才停下的视角，不能回退到原始全景图。
    const interactiveFrame = await screenshotPrimarySurface()
    await page.mouse.move(20, 80)
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-panorama-inline-surface] [data-panorama-surface="sphere"] canvas').length === 0
    ), undefined, { timeout: 8000 })
    if (await activeInlineCanvases.count()) throw new Error('指针移出全景节点后仍保留内嵌 WebGL Canvas')
    const frozenPreview = primarySurface.locator('img[data-panorama-frozen-preview="true"]')
    await frozenPreview.waitFor({ state: 'visible', timeout: 8000 })
    const frozenFrame = await screenshotPrimarySurface()
    const frozenFrameDiff = await diffBuffers(interactiveFrame, frozenFrame)
    if (frozenFrameDiff.changedPct > 1) {
      throw new Error(`全景冻结帧不是所见即所得：变化像素 ${frozenFrameDiff.changedPct}%`)
    }

    // 项目重开后直接显示上次冻结视角，并从同一相机状态继续交互。
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    await resultNode.waitFor({ state: 'visible', timeout: 12000 })
    await frozenPreview.waitFor({ state: 'visible', timeout: 12000 })
    await page.mouse.move(20, 80)
    await primarySurface.hover()
    await waitForPanoramaCanvas(primarySphere, '项目重开后恢复')
    await primarySurface.locator('[data-panorama-transition-preview="true"]')
      .waitFor({ state: 'detached', timeout: 8000 })

    const flatButton = resultNode.getByRole('button', { name: /^(平面|Flat)$/i })
    const sphereButton = resultNode.getByRole('button', { name: /^(球面|Sphere)$/i })
    await flatButton.click()
    await primarySurface.locator('img').waitFor({ state: 'visible', timeout: 8000 })
    if (await primarySphere.count()) throw new Error('平面模式仍保留全景 WebGL Canvas')
    await sphereButton.click()
    await waitForPanoramaCanvas(primarySphere, '平面切回球面')

    const viewportRatioButton = resultNode.getByRole('button', { name: /^(视口比例|Viewport ratio)$/i })
    await viewportRatioButton.click()
    const visibleRatioOptions = page.locator('[data-dropdown-portal="true"] [role="option"]:visible')
    const ratioLabels = await visibleRatioOptions.evaluateAll((elements) => (
      elements.map((element) => element.textContent?.trim()).filter(Boolean)
    ))
    const expectedRatioLabels = ['21:9', '16:9', '3:2', '4:3', '1:1']
    if (JSON.stringify(ratioLabels) !== JSON.stringify(expectedRatioLabels)) {
      throw new Error(`全景视口比例选项不符合五档约定：${JSON.stringify(ratioLabels)}`)
    }
    await page.getByRole('option', { name: '4:3', exact: true }).click()
    await page.waitForFunction(() => (
      document.querySelector('[data-panorama-viewer-node-id="__ui_panorama_result"]')
        ?.getAttribute('data-panorama-viewport-ratio') === '4:3'
    ))

    const exportNodeIdsBeforeCapture = await page.locator('.react-flow__node-exportImageNode')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id')).filter(Boolean))
    await resultNode.getByRole('button', { name: /^(截取视角|Capture view)$/i }).click()
    await page.waitForFunction((knownIds) => (
      Array.from(document.querySelectorAll('.react-flow__node-exportImageNode'))
        .some((element) => !knownIds.includes(element.getAttribute('data-id')))
    ), exportNodeIdsBeforeCapture, { timeout: 20000 })
    const snapshotNodeId = await page.locator('.react-flow__node-exportImageNode')
      .evaluateAll((elements, knownIds) => (
        elements.map((element) => element.getAttribute('data-id'))
          .find((nodeId) => nodeId && !knownIds.includes(nodeId)) ?? null
      ), exportNodeIdsBeforeCapture)
    if (!snapshotNodeId) throw new Error('截取视角未创建普通图片节点')

    // 节点内交互完成后，双击仍可进入沉浸式查看器。
    await primarySurface.hover()
    await waitForPanoramaCanvas(primarySphere, '截取视角后恢复')
    await primarySurface.dblclick({ position: { x: 80, y: 80 } })

    const viewer = page.locator('[data-panorama-viewer="true"]')
    await viewer.waitFor({ state: 'visible', timeout: 12000 })
    const sphere = viewer.locator('[data-panorama-surface="sphere"] canvas')
    await sphere.waitFor({ state: 'visible', timeout: 12000 })
    await page.mouse.wheel(0, -180)

    await viewer.getByRole('button', { name: /^(平面|Flat)$/i }).click()
    await viewer.locator('[data-panorama-surface="flat"]').waitFor({ state: 'visible', timeout: 8000 })
    await viewer.getByRole('button', { name: /^(球面|Sphere)$/i }).click()
    await sphere.waitFor({ state: 'visible', timeout: 8000 })
    await viewer.getByTitle(/^(重置视图|Reset View)$/i).click()

    await viewer.getByTitle(/^(关闭|Close)$/i).click()
    await viewer.waitFor({ state: 'hidden', timeout: 8000 })
    const downloadDir = await page.evaluate(async () => {
      const root = await window.henjiNative.paths.tempDir()
      const target = await window.henjiNative.paths.join(root, `henji-panorama-ui-${Date.now()}`)
      await window.henjiNative.fs.mkdir(target, { recursive: true })
      localStorage.setItem('enable_quick_download', 'true')
      localStorage.setItem('quick_download_path', target)
      return target
    })
    await resultNode.click()
    await page.getByRole('button', { name: /^(下载|Download)$/i }).filter({ visible: true }).first().click()
    let downloadedPath = null
    for (let attempt = 0; attempt < 30; attempt += 1) {
      downloadedPath = await page.evaluate(async (targetDir) => {
        const entries = await window.henjiNative.fs.readDir(targetDir)
        const file = entries.find((entry) => !entry.isDirectory && /\.png$/i.test(entry.name))
        return file ? await window.henjiNative.paths.join(targetDir, file.name) : null
      }, downloadDir)
      if (downloadedPath) break
      await page.waitForTimeout(200)
    }
    if (!downloadedPath) throw new Error('全景快速下载未落盘')
    const downloadedMetadata = await page.evaluate(
      async (source) => await window.henjiNative.image.readPanoramaImageMetadata(source),
      downloadedPath
    )
    if (downloadedMetadata.status !== 'valid' || downloadedMetadata.metadata?.projectionType !== 'equirectangular') {
      throw new Error(`全景下载文件 GPano 往返失败：${JSON.stringify(downloadedMetadata)}`)
    }

    const packageRoundTrip = await page.evaluate(async ({ targetDir, mediaPath }) => {
      const packagePath = await window.henjiNative.paths.join(targetDir, 'panorama-roundtrip.henjiproj')
      const packageMediaPath = 'media/1-panorama.png'
      const manifest = {
        formatVersion: 1,
        app: 'henji-ai',
        nodes: [{
          id: '__ui_panorama_package_result',
          type: 'exportImageNode',
          position: { x: 0, y: 0 },
          data: { imageUrl: packageMediaPath, resultKind: 'panorama', aspectRatio: '2:1' },
        }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      await window.henjiNative.projectPackage.exportProjectPackage(
        JSON.stringify(manifest),
        [{ srcPath: mediaPath, packagePath: packageMediaPath }],
        packagePath
      )
      const imported = await window.henjiNative.projectPackage.importProjectPackage(packagePath)
      const importedManifest = JSON.parse(imported.manifestJson)
      const importedMediaPath = imported.pathMap[packageMediaPath]
      const importedMetadata = importedMediaPath
        ? await window.henjiNative.image.readPanoramaImageMetadata(importedMediaPath)
        : null
      return {
        resultKind: importedManifest.nodes?.[0]?.data?.resultKind,
        importedMediaPath,
        metadataStatus: importedMetadata?.status,
      }
    }, { targetDir: downloadDir, mediaPath: downloadedPath })
    if (packageRoundTrip.resultKind !== 'panorama'
      || !packageRoundTrip.importedMediaPath
      || packageRoundTrip.metadataStatus !== 'valid') {
      throw new Error(`全景项目包导出导入往返失败：${JSON.stringify(packageRoundTrip)}`)
    }

    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 600)
    const persisted = await page.evaluate(async (payload) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json, history_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [payload.projectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const history = JSON.parse(rows[0]?.history_json ?? '{}')
      const primary = nodes.find((node) => node.id === '__ui_panorama_result')
      const secondary = nodes.find((node) => node.id === '__ui_panorama_result_secondary')
      const snapshot = nodes.find((node) => node.id === payload.snapshotNodeId)
      const snapshotSourceRef = snapshot?.data?.imageUrl
      const snapshotSourceIndex = typeof snapshotSourceRef === 'string' && snapshotSourceRef.startsWith('__img_ref__:')
        ? Number.parseInt(snapshotSourceRef.slice('__img_ref__:'.length), 10)
        : null
      const snapshotSource = Number.isInteger(snapshotSourceIndex)
        ? history.imagePool?.[snapshotSourceIndex]
        : snapshotSourceRef
      return {
        hasGeneratedNode: nodes.some((node) => node.id === payload.generatedNodeId && node.type === 'panoramaGenNode'),
        primaryType: primary?.type,
        secondaryType: secondary?.type,
        resultKind: primary?.data?.resultKind,
        viewMode: primary?.data?.viewMode,
        viewportAspectRatio: primary?.data?.viewportAspectRatio,
        cameraView: primary?.data?.cameraView,
        panoramaPreviewImageUrl: primary?.data?.panoramaPreviewImageUrl,
        snapshotType: snapshot?.type,
        snapshotResultKind: snapshot?.data?.resultKind,
        snapshotAspectRatio: snapshot?.data?.aspectRatio,
        snapshotSource,
        hasSnapshotEdge: edges.some((edge) => (
          edge.source === '__ui_panorama_result' && edge.target === payload.snapshotNodeId
        )),
        edgeCount: edges.length,
      }
    }, { generatedNodeId, projectId, snapshotNodeId })
    if (!persisted.hasGeneratedNode
      || persisted.primaryType !== 'panoramaViewerNode'
      || persisted.secondaryType !== 'panoramaViewerNode'
      || persisted.resultKind !== 'panorama'
      || persisted.viewMode !== 'sphere'
      || persisted.viewportAspectRatio !== '4:3'
      || !Number.isFinite(persisted.cameraView?.yaw)
      || !Number.isFinite(persisted.cameraView?.pitch)
      || Math.abs(persisted.cameraView.yaw) < 0.01
      || Math.abs(persisted.cameraView.pitch) < 0.01
      || !persisted.panoramaPreviewImageUrl
      || persisted.snapshotType !== 'exportImageNode'
      || persisted.snapshotResultKind !== 'image'
      || persisted.snapshotAspectRatio !== '4:3'
      || !persisted.snapshotSource
      || !persisted.hasSnapshotEdge
      || persisted.edgeCount < 2) {
      throw new Error(`全景项目保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }
    const snapshotInfo = await page.evaluate(
      async (source) => await window.henjiNative.image.readImageInfo(source),
      persisted.snapshotSource
    )
    if (snapshotInfo.width !== 960 || snapshotInfo.height !== 720) {
      throw new Error(`4:3 全景视角截图尺寸错误：${snapshotInfo.width}×${snapshotInfo.height}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopenedResult = page.locator('.react-flow__node[data-id="__ui_panorama_result"]')
    await reopenedResult.waitFor({ state: 'visible', timeout: 12000 })
    await page.locator(`.react-flow__node[data-id="${generatedNodeId}"]`).waitFor({ state: 'visible', timeout: 12000 })
    const reopenedInlineViewer = reopenedResult.locator('[data-panorama-viewer-node-id="__ui_panorama_result"]')
    if (await reopenedInlineViewer.getAttribute('data-panorama-viewport-ratio') !== '4:3') {
      throw new Error('重开后全景视口比例未恢复')
    }
    const reopenedSurface = reopenedInlineViewer.locator('[data-panorama-inline-surface]')
    await reopenedSurface.hover()
    await waitForPanoramaCanvas(
      reopenedSurface.locator('[data-panorama-surface="sphere"] canvas'),
      '最终持久化核验后重开',
    )
    await reopenedSurface.dblclick({ position: { x: 80, y: 80 } })
    await viewer.waitFor({ state: 'visible', timeout: 12000 })
    await viewer.locator('[data-panorama-surface="sphere"] canvas').waitFor({ state: 'visible', timeout: 12000 })
    await page.evaluate(async (targetDir) => {
      localStorage.removeItem('enable_quick_download')
      localStorage.removeItem('quick_download_path')
      await window.henjiNative.fs.remove(targetDir, { recursive: true })
    }, downloadDir)
    await settlePage(page, 900)
  }

  Object.assign(context, {
    setupCanvasPanoramaViewer,
  })
}

module.exports = { attachUiInspectionCanvasPanorama }
