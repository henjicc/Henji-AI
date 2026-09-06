async function openCanvasImageEditorV3Fixture({
  page,
  context,
  width,
  height,
  label,
  sourceWidth = width,
  sourceHeight = height,
  transform = [1, 0, 0, 1, 0, 0],
  solidColor = null,
  foreground = null,
}) {
  const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await context.settlePage(page, 500)
  const fixture = await page.evaluate(async (payload) => {
    const canvas = document.createElement('canvas')
    canvas.width = payload.sourceWidth
    canvas.height = payload.sourceHeight
    const drawing = canvas.getContext('2d')
    if (!drawing) throw new Error(`${payload.label}夹具画布不可用`)
    const gradient = drawing.createLinearGradient(0, 0, payload.width, payload.height)
    gradient.addColorStop(0, 'rgb(14, 116, 144)')
    gradient.addColorStop(0.5, 'rgb(124, 58, 237)')
    gradient.addColorStop(1, 'rgb(244, 63, 94)')
    drawing.fillStyle = gradient
    drawing.fillRect(0, 0, payload.width, payload.height)
    drawing.fillStyle = 'rgba(255, 255, 255, 0.72)'
    drawing.beginPath()
    drawing.arc(payload.width * 0.33, payload.height * 0.5, payload.height * 0.24, 0, Math.PI * 2)
    drawing.fill()
    drawing.fillStyle = 'rgba(15, 23, 42, 0.68)'
    drawing.fillRect(payload.width * 0.58, payload.height * 0.18, payload.width * 0.27, payload.height * 0.64)
    if (payload.solidColor) {
      drawing.fillStyle = payload.solidColor
      drawing.fillRect(0, 0, canvas.width, canvas.height)
    }
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error(`${payload.label}夹具编码失败`)),
      'image/png',
    ))
    const source = await window.henjiNative.image.persistImageBinary(
      new Uint8Array(await blob.arrayBuffer()),
      'png',
    )
    const managed = await window.henjiNative.imageEditorV3.ingestSource({
      requestId: `reality-canvas-gpu-ingest-${crypto.randomUUID()}`,
      source: { kind: 'local-path', filePath: source },
    })
    let foregroundSource = null
    if (payload.foreground) {
      const overlay = document.createElement('canvas')
      overlay.width = payload.foreground.width
      overlay.height = payload.foreground.height
      const paint = overlay.getContext('2d')
      if (!paint) throw new Error('独立前景夹具画布不可用')
      paint.fillStyle = payload.foreground.color
      paint.fillRect(0, 0, overlay.width, overlay.height)
      if (payload.foreground.contentRect) {
        paint.clearRect(0, 0, overlay.width, overlay.height)
        paint.fillRect(...payload.foreground.contentRect)
      }
      if (payload.foreground.hole) paint.clearRect(...payload.foreground.hole)
      foregroundSource = await window.henjiNative.imageEditorV3.ingestSource({
        requestId: `reality-canvas-foreground-ingest-${crypto.randomUUID()}`,
        source: { kind: 'data-url', dataUrl: overlay.toDataURL('image/png') },
      })
      if (foregroundSource.resource.resourceRef === managed.resource.resourceRef) {
        throw new Error('前景和背景必须是两个独立图片资源')
      }
    }
    const documentId = `reality-canvas-gpu-${crypto.randomUUID()}`
    const saved = await window.henjiNative.imageEditorV3.saveDocument({
      requestId: `reality-canvas-gpu-save-${crypto.randomUUID()}`,
      document: {
        version: 3,
        id: documentId,
        revision: 0,
        geometry: {
          width: payload.width,
          height: payload.height,
          orientation: { rotate: 0, mirrored: false },
          crop: null,
        },
        color: {
          workingSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb',
          hdrMetadata: null, iccProfileResourceId: null,
        },
        layers: [{
          id: 'reality-gpu-source-layer', name: payload.label, type: 'raster',
          visible: true, locked: false, opacity: 1, blendMode: 'normal',
          transform: payload.transform, mask: null,
          source: { kind: 'resource', resourceId: managed.resource.resourceRef }, tiles: {},
        }, ...(foregroundSource ? [{
          id: 'reality-gpu-foreground-layer', name: '独立前景', type: 'raster',
          visible: true, locked: false, opacity: 1, blendMode: 'normal',
          transform: payload.foreground.transform, mask: null,
          source: { kind: 'resource', resourceId: foregroundSource.resource.resourceRef }, tiles: {},
        }] : [])],
      },
      expectedRevision: 0,
      history: null,
      resourceRefs: [managed.resource.resourceRef, ...(foregroundSource ? [foregroundSource.resource.resourceRef] : [])],
      previewRef: null,
    })
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
      [payload.projectId],
    )
    const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
    const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
    const nodeId = '__ui_canvas_gpu_diagnostic_document'
    nodes.push({
      id: nodeId,
      type: 'layerStackResultNode',
      position: { x: 720, y: 80 },
      width: 520,
      height: 300,
      measured: { width: 520, height: 300 },
      style: { width: 520, height: 300 },
      data: {
        displayName: payload.label,
        imageUrl: managed.mediaUrl,
        previewImageUrl: managed.mediaUrl,
        aspectRatio: `${payload.width}:${payload.height}`,
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
      id: '__ui_canvas_gpu_diagnostic_edge',
      source: '__ui_panorama_source', target: nodeId,
      sourceHandle: 'source', targetHandle: 'target',
    })
    await window.henjiNative.db.execute(
      'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
      [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 50, y: 120, zoom: 0.7 }), payload.projectId],
    )
    return { nodeId, documentRef: saved.documentRef, initialRevision: saved.revision,
      sourceResourceRef: managed.resource.resourceRef,
      foregroundResourceRef: foregroundSource?.resource.resourceRef ?? null,
      sourceGeometry: { width: managed.metadata.width, height: managed.metadata.height } }
  }, { projectId, width, height, label, sourceWidth, sourceHeight, transform, solidColor, foreground })
  await page.locator(`[data-project-id="${projectId}"]:visible`).click()
  const node = page.locator(`[data-layer-stack-node-id="${fixture.nodeId}"][data-layer-stack-status="editable-v3"]`)
  await node.waitFor({ state: 'visible', timeout: 12000 })
  await node.dblclick()
  const dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
  await dialog.waitFor({ state: 'visible', timeout: 15000 })
  const editor = dialog.locator('[data-image-editor-v3]')
  await editor.waitFor({ state: 'visible', timeout: 60000 })
  return { dialog, editor, fixture, projectId }
}

module.exports = { openCanvasImageEditorV3Fixture }
