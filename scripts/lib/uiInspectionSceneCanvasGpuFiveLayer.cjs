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
      const specs = [
        ['ui-background-layer', '背景图层', 960, 640, 0, 0, 'rgb(28,92,218)'],
        ['ui-prop-layer', '道具元素', 160, 160, 60, 80, 'rgb(226,78,130)'],
        ['ui-clothing-layer', '服饰元素', 180, 220, 300, 100, 'rgb(246,190,60)'],
        ['ui-decoration-layer', '装饰元素', 200, 120, 80, 410, 'rgb(35,185,120)'],
        ['ui-foreground-layer', '前景元素', 220, 180, 560, 260, 'rgb(165,65,220)'],
      ]
      const sources = []
      for (const [, , width, height, , , color] of specs) {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        const drawing = canvas.getContext('2d')
        if (!drawing) throw new Error('合成五层夹具画布不可用')
        drawing.fillStyle = color; drawing.fillRect(0, 0, width, height)
        drawing.fillStyle = 'rgb(255,255,255)'; drawing.fillRect(12, 12, 28, 28)
        sources.push(await window.henjiNative.imageEditorV3.ingestSource({
          requestId: `reality-synthetic-five-layer-${crypto.randomUUID()}`,
          source: { kind: 'data-url', dataUrl: canvas.toDataURL('image/png') },
        }))
      }
      const managed = sources[0]
      if (new Set(sources.map((source) => source.resource.resourceRef)).size !== 5) throw new Error('合成五层必须是五个独立资源')
      const common = (id, name, transform, resourceRef) => ({
        id,
        name,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform,
        mask: null,
        type: 'raster',
        source: { kind: 'resource', resourceId: resourceRef },
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
        layers: specs.map(([id, name, , , x, y], index) => common(id, name, [1, 0, 0, 1, x, y], sources[index].resource.resourceRef)),
      }
      const saved = await window.henjiNative.imageEditorV3.saveDocument({
        requestId: `reality-gpu-five-layer-save-${crypto.randomUUID()}`,
        document: editDocument,
        expectedRevision: 0,
        history: null,
        resourceRefs: sources.map((source) => source.resource.resourceRef),
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
          displayName: '合成五独立资源 GPU 基准',
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
        fixtureKind: 'synthetic-five-independent-resources',
        resourceCount: 5,
        expectedColors: specs.map((spec) => spec[6].match(/\d+/g).map(Number)),
      }
    }, projectId)
    fixture.windowSize = inspection?.requestedWindowSize ?? null
    const verified = await verifyMultiLayerDragPerformance({
      page, app, projectId, fixture, settlePage, inspection,
    })
    console.log(`[image-editor-gpu-baseline] ${JSON.stringify({
      fixture: 'synthetic-five-independent-resources',
      path: 'webgpu-surface-transient-transform',
      ...verified.dragBaseline,
    })}`)
  }

  Object.assign(context, { setupCanvasGpuFiveLayerPerformance })
}

module.exports = { attachUiInspectionCanvasGpuFiveLayer }
