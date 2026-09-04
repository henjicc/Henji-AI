const {
  verifyMultiLayerDragPerformance,
} = require('./uiInspectionMultiLayerDragPerformance.cjs')

function attachUiInspectionCanvasGpuFiveLayer(context) {
  const { seedAndOpenCanvasPanoramaProject, settlePage } = context

  async function setupCanvasGpuFiveLayerPerformance(page, app, inspection) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const fixture = await page.evaluate(async (targetProjectId) => {
      const fixtureCanvas = document.createElement('canvas')
      fixtureCanvas.width = 320
      fixtureCanvas.height = 240
      const context = fixtureCanvas.getContext('2d')
      if (!context) throw new Error('固定 KIE 五层夹具画布不可用')
      const gradient = context.createLinearGradient(0, 0, 320, 240)
      gradient.addColorStop(0, 'rgb(28, 92, 218)')
      gradient.addColorStop(0.55, 'rgb(226, 78, 130)')
      gradient.addColorStop(1, 'rgb(246, 190, 60)')
      context.fillStyle = gradient
      context.fillRect(0, 0, 320, 240)
      context.fillStyle = 'rgba(255, 255, 255, 0.72)'
      context.fillRect(34, 42, 104, 88)
      context.fillStyle = 'rgba(18, 30, 58, 0.82)'
      context.beginPath()
      context.arc(224, 132, 54, 0, Math.PI * 2)
      context.fill()
      const managed = await window.henjiNative.imageEditorV3.ingestSource({
        requestId: `reality-gpu-five-layer-ingest-${crypto.randomUUID()}`,
        source: { kind: 'data-url', dataUrl: fixtureCanvas.toDataURL('image/png') },
      })
      const common = (id, name, transform) => ({
        id,
        name,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform,
        mask: null,
        type: 'raster',
        source: { kind: 'resource', resourceId: managed.resource.resourceRef },
        tiles: {},
      })
      const editDocument = {
        version: 3,
        id: `reality-gpu-five-layer-${crypto.randomUUID()}`,
        revision: 0,
        geometry: {
          width: managed.metadata.width,
          height: managed.metadata.height,
          orientation: { rotate: 0, mirrored: false },
          crop: null,
        },
        color: {
          workingSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb',
          hdrMetadata: null, iccProfileResourceId: null,
        },
        layers: [
          common('ui-background-layer', '背景图层', [1, 0, 0, 1, 0, 0]),
          common('ui-prop-layer', '道具元素', [0.35, 0, 0, 0.35, 40, 180]),
          common('ui-clothing-layer', '服饰元素', [0.45, 0, 0, 0.45, 260, 80]),
          common('ui-decoration-layer', '装饰元素', [0.25, 0, 0, 0.25, 420, 220]),
          common('ui-foreground-layer', '前景元素', [0.55, 0, 0, 0.55, 180, 100]),
        ],
      }
      const saved = await window.henjiNative.imageEditorV3.saveDocument({
        requestId: `reality-gpu-five-layer-save-${crypto.randomUUID()}`,
        document: editDocument,
        expectedRevision: 0,
        history: null,
        resourceRefs: [managed.resource.resourceRef],
        previewRef: null,
      })
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const nodeId = '__ui_gpu_five_layer_document'
      nodes.push({
        id: nodeId,
        type: 'layerStackResultNode',
        position: { x: 720, y: 80 },
        width: 520,
        height: 300,
        measured: { width: 520, height: 300 },
        style: { width: 520, height: 300 },
        data: {
          displayName: '固定 KIE 五层 GPU 基准',
          imageUrl: managed.mediaUrl,
          previewImageUrl: managed.mediaUrl,
          aspectRatio: `${managed.metadata.width}:${managed.metadata.height}`,
          resultKind: 'layer-stack',
          imageEditSession: {
            kind: 'image-edit-v3', sourceUrl: managed.mediaUrl,
            documentRef: saved.documentRef, revision: saved.revision,
            previewRef: saved.previewRef,
          },
          isGenerating: false,
        },
      })
      edges.push({
        id: '__ui_gpu_five_layer_edge',
        source: '__ui_panorama_source',
        target: nodeId,
        sourceHandle: 'source',
        targetHandle: 'target',
      })
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 50, y: 120, zoom: 0.7 }), targetProjectId]
      )
      return {
        documentRef: saved.documentRef,
        initialRevision: saved.revision,
        nodeId,
        complexGraph: false,
      }
    }, projectId)
    const browserWindow = await app.browserWindow(page)
    const [width, height] = await browserWindow.evaluate((windowHandle) => windowHandle.getSize())
    fixture.windowSize = { width, height }
    const verified = await verifyMultiLayerDragPerformance({
      page, projectId, fixture, settlePage, inspection,
    })
    console.log(`[image-editor-gpu-baseline] ${JSON.stringify({
      fixture: 'kie-five-layer',
      path: 'webgpu-surface-transient-transform',
      ...verified.dragBaseline,
    })}`)
  }

  Object.assign(context, { setupCanvasGpuFiveLayerPerformance })
}

module.exports = { attachUiInspectionCanvasGpuFiveLayer }
