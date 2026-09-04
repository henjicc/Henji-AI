const {
  selectOverlappingReactFlowNode,
  verifyHiddenBackgroundRasterStack,
  verifyMultiLayerDragPerformance,
} = require('./uiInspectionMultiLayerDragPerformance.cjs')

function attachUiInspectionCanvasEditing(context) {
  const {
    settlePage,
    clickCanvasCapabilityAction,
    resizeCanvasNodeAndAssertHitBox,
    seedAndOpenCanvasPanoramaProject,
  } = context

  async function setupCanvasElementEditNode(page) {
    const { panoramaSource, projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)
    await clickCanvasCapabilityAction(page, {
      directName: /^(局部重绘|Local Redraw)$/i,
      menuName: /^(局部重绘|Local Redraw)/i,
      missingMessage: '局部重绘工具入口不可见',
    })

    const shell = page.locator('[data-generation-node-id][data-generation-node-model-id="apimart-gpt-image-2"]')
      .filter({ hasText: /局部重绘|Local Redraw/ }).last()
    await shell.waitFor({ state: 'visible', timeout: 12000 })
    const node = shell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    const nodeId = await node.getAttribute('data-id')
    if (!nodeId || nodeId === '__ui_panorama_source') throw new Error('局部重绘工具条未创建独立相邻节点')
    if (!(await node.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('局部重绘工具条创建后未选中新节点')
    }
    if (await page.locator('.react-flow__edge').count() < 1) throw new Error('局部重绘工具条未创建源图连线')
    if (await page.getByRole('dialog', { name: /绘制局部重绘遮罩|Draw Inpainting Mask/i }).filter({ visible: true }).count()) {
      throw new Error('局部重绘节点不应再依赖独立遮罩弹窗')
    }
    const editor = shell.locator('[data-local-redraw-workbench="true"]')
    await editor.waitFor({ state: 'visible', timeout: 12000 })
    await resizeCanvasNodeAndAssertHitBox(page, node, shell, '局部重绘节点')
    for (const settingLabel of [
      /^(上下文范围|Context range)$/i,
      /^(裁剪比例|Crop ratio)$/i,
      /^(对齐精度|Alignment quality)$/i,
      /^(遮罩羽化|Mask feather)$/i,
      /^(强制对齐|Force alignment)$/i,
    ]) {
      await shell.getByText(settingLabel).waitFor({ state: 'visible', timeout: 8000 })
    }
    const canvasRegion = editor.locator('[data-application-observation-region="mask_editor.canvas"]')
    const box = await canvasRegion.boundingBox()
    if (!box) throw new Error('局部重绘遮罩没有可绘制区域')
    await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.42)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.58, { steps: 10 })
    await page.mouse.up()
    await editor.locator('[data-local-redraw-autosave-status="saved"]')
      .waitFor({ state: 'visible', timeout: 12000 })
    if (await editor.getByRole('button', { name: /保存遮罩|完成|确认/ }).count()) {
      throw new Error('局部重绘仍要求手动确认或保存遮罩')
    }

    const prompt = shell.getByRole('textbox', { name: /描述要如何修改蒙版选区|Describe how to change the masked area/i })
    await prompt.waitFor({ state: 'visible', timeout: 8000 })
    await prompt.click()
    const activePrompt = shell.locator('[contenteditable="true"]').first()
    await activePrompt.waitFor({ state: 'visible', timeout: 8000 })
    await activePrompt.fill('将选区替换为柔和的云层')
    await activePrompt.blur()
    await settlePage(page, 800)

    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId, source }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const target = nodes.find((candidate) => candidate.id === targetNodeId)
      const maskSource = target?.data?.localRedrawMaskSource
      const document = target?.data?.localRedrawMaskDocument
      return {
        nodeType: target?.type,
        capabilityId: target?.data?.capabilityId,
        modelId: target?.data?.modelId,
        prompt: target?.data?.prompt,
        hasManagedMask: typeof maskSource === 'string' && maskSource !== source,
        documentVersion: document?.version,
        documentSourceRef: document?.sourceRef,
        strokeCount: document?.strokes?.length ?? 0,
        registrationQuality: target?.data?.localRedrawSettings?.registrationQuality,
        manuallyResized: target?.data?.isSizeManuallyAdjusted,
        width: target?.width,
        height: target?.height,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
      }
    }, { targetProjectId: projectId, targetNodeId: nodeId, source: panoramaSource })
    if (persisted.nodeType !== 'elementEditGenNode'
      || persisted.capabilityId !== 'image.element-edit'
      || persisted.modelId !== 'apimart-gpt-image-2'
      || persisted.prompt !== '将选区替换为柔和的云层'
      || !persisted.hasManagedMask
      || persisted.documentVersion !== 1
      || !String(persisted.documentSourceRef ?? '').startsWith('__img_ref__:')
      || persisted.strokeCount < 1
      || persisted.registrationQuality !== 'precise'
      || persisted.manuallyResized !== true
      || persisted.width <= 640
      || persisted.height <= 360
      || !persisted.hasSourceEdge) {
      throw new Error(`局部重绘保存语义或连线丢失：${JSON.stringify(persisted)}`)
    }

    await page.evaluate(async ({ targetProjectId, targetNodeId, resultSource }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const generator = nodes.find((candidate) => candidate.id === targetNodeId)
      nodes.push({
        id: '__ui_element_edit_result', type: 'exportImageNode',
        position: { x: (generator?.position?.x ?? 720) + 430, y: generator?.position?.y ?? 80 },
        width: 384, height: 220, measured: { width: 384, height: 220 }, style: { width: 384, height: 220 },
        data: {
          displayName: '局部重绘结果（本地模拟）', resultKind: 'image', sourceCapabilityId: 'image.element-edit',
          imageUrl: resultSource, previewImageUrl: resultSource, aspectRatio: '2:1', isGenerating: false,
        },
      })
      edges.push({
        id: `__ui_element_edit_result_edge_${targetNodeId}`,
        source: targetNodeId, target: '__ui_element_edit_result', sourceHandle: 'source', targetHandle: 'target',
      })
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [nodes.length, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify({ x: 60, y: 80, zoom: 0.82 }), targetProjectId]
      )
    }, { targetProjectId: projectId, targetNodeId: nodeId, resultSource: panoramaSource })

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopened = page.locator(`[data-generation-node-id="${nodeId}"][data-generation-node-model-id="apimart-gpt-image-2"]`)
    await reopened.waitFor({ state: 'visible', timeout: 12000 })
    await page.locator('.react-flow__node[data-id="__ui_element_edit_result"]')
      .getByText('局部重绘结果（本地模拟）').waitFor({ state: 'visible', timeout: 8000 })
    await reopened.click()
    const reopenedEditor = reopened.locator('[data-local-redraw-workbench="true"]')
    await reopenedEditor.waitFor({ state: 'visible', timeout: 12000 })
    await reopenedEditor.locator('[data-application-observation-region="mask_editor.canvas"]')
      .waitFor({ state: 'visible', timeout: 12000 })
    if (await reopenedEditor.getByRole('button', { name: /清空遮罩/ }).isDisabled()) {
      throw new Error('局部重绘节点重开后没有恢复已保存的遮罩文档')
    }
    await settlePage(page, 900)
  }

  async function setupCanvasMultiLayerDocumentEditor(page, _app, inspection) {
    const { panoramaSource, projectId } = await seedAndOpenCanvasPanoramaProject(page)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 700)
    const fixture = await page.evaluate(async ({ targetProjectId, source }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const documentId = `ui-multi-layer-${crypto.randomUUID()}`
      const managed = await window.henjiNative.imageEditorV3.ingestSource({
        requestId: `reality-multi-layer-ingest-${crypto.randomUUID()}`,
        source: { kind: 'local-path', filePath: source },
      })
      const common = (id, name) => ({
        id,
        name,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        transform: [1, 0, 0, 1, 0, 0],
        mask: null,
        type: 'raster',
        source: { kind: 'resource', resourceId: managed.resource.resourceRef },
        tiles: {},
      })
      const document = {
        version: 3,
        id: documentId,
        revision: 0,
        geometry: {
          width: managed.metadata.width,
          height: managed.metadata.height,
          orientation: { rotate: 0, mirrored: false },
          crop: null,
        },
        color: {
          workingSpace: 'srgb',
          bitDepth: 8,
          transferFunction: 'srgb',
          hdrMetadata: null,
          iccProfileResourceId: null,
        },
        layers: [
          common('ui-background-layer', '背景图层'),
          {
            ...common('ui-prop-layer', '道具元素'),
            transform: [0.35, 0, 0, 0.35, 40, 180],
          },
          {
            ...common('ui-clothing-layer', '服饰元素'),
            transform: [0.45, 0, 0, 0.45, 260, 80],
          },
          {
            ...common('ui-decoration-layer', '装饰元素'),
            transform: [0.25, 0, 0, 0.25, 420, 220],
          },
          {
            ...common('ui-foreground-layer', '前景元素'),
            transform: [0.55, 0, 0, 0.55, 180, 100],
          },
        ],
      }
      const saved = await window.henjiNative.imageEditorV3.saveDocument({
        requestId: `reality-multi-layer-save-${crypto.randomUUID()}`,
        document,
        expectedRevision: 0,
        history: null,
        resourceRefs: [managed.resource.resourceRef],
        previewRef: null,
      })
      const nodeId = '__ui_multi_layer_document_result'
      nodes.push({
        id: nodeId,
        type: 'layerStackResultNode',
        position: { x: 720, y: 80 },
        width: 520,
        height: 300,
        measured: { width: 520, height: 300 },
        style: { width: 520, height: 300 },
        data: {
          displayName: '多图层图片文档（本地模拟）',
          imageUrl: managed.mediaUrl,
          previewImageUrl: managed.mediaUrl,
          aspectRatio: `${managed.metadata.width}:${managed.metadata.height}`,
          resultKind: 'layer-stack',
          imageEditSession: {
            kind: 'image-edit-v3',
            sourceUrl: managed.mediaUrl,
            documentRef: saved.documentRef,
            revision: saved.revision,
            previewRef: saved.previewRef,
          },
          isGenerating: false,
        },
      })
      const legacyNodeId = '__ui_multi_layer_legacy_result'
      const legacyCompletionId = `generation-output:${legacyNodeId}`
      let legacyHash = 2166136261
      for (let index = 0; index < legacyCompletionId.length; index += 1) {
        legacyHash ^= legacyCompletionId.charCodeAt(index)
        legacyHash = Math.imul(legacyHash, 16777619)
      }
      const legacyStackId = `layer-stack:${(legacyHash >>> 0).toString(36)}`
      const legacyResourceId = `${legacyStackId}:resource:0`
      const legacyDocument = {
        version: 1,
        stackId: legacyStackId,
        status: 'ready',
        source: {
          capabilityId: 'image.layer-separation',
          sourceNodeId: '__ui_panorama_source',
          inputResourceId: source,
          inputResourceStatus: 'ready',
          providerId: 'volcengine',
          modelId: 'volcengine-seedream-5.0-pro',
          completionId: legacyCompletionId,
        },
        canvas: {
          width: managed.metadata.width,
          height: managed.metadata.height,
          colorSpace: 'srgb',
          alphaMode: 'straight',
          compositeOperation: 'source-over',
          clipPolicy: 'canvas-bounds',
        },
        compositeResourceId: `${legacyStackId}:composite`,
        thumbnailResourceId: `${legacyStackId}:thumbnail`,
        layers: [{
          version: 1,
          layerId: `${legacyStackId}:layer:0`,
          sourceOutputIndex: 0,
          providerZIndex: 0,
          order: 0,
          role: 'base',
          name: '旧版底图',
          resourceId: legacyResourceId,
          placement: { x: 0, y: 0, width: managed.metadata.width, height: managed.metadata.height },
          opacity: 1,
          visible: true,
          blendMode: 'normal',
          alpha: 'opaque',
        }],
        resources: [
          { version: 1, resourceId: legacyResourceId, status: 'ready', filePath: source, mimeType: 'image/jpeg', width: managed.metadata.width, height: managed.metadata.height, hasAlpha: false, byteLength: null, sha256: 'ui-legacy-base' },
          { version: 1, resourceId: `${legacyStackId}:composite`, status: 'ready', filePath: source, mimeType: 'image/png', width: managed.metadata.width, height: managed.metadata.height, hasAlpha: true, byteLength: null, sha256: 'ui-legacy-composite' },
          { version: 1, resourceId: `${legacyStackId}:thumbnail`, status: 'ready', filePath: source, mimeType: 'image/webp', width: managed.metadata.width, height: managed.metadata.height, hasAlpha: false, byteLength: null, sha256: 'ui-legacy-thumbnail' },
        ],
      }
      nodes.push({
        id: legacyNodeId,
        type: 'layerStackResultNode',
        position: { x: 720, y: 460 },
        width: 520,
        height: 300,
        measured: { width: 520, height: 300 },
        style: { width: 520, height: 300 },
        data: {
          displayName: '旧版多图层图片文档（迁移夹具）',
          imageUrl: source,
          previewImageUrl: source,
          aspectRatio: `${managed.metadata.width}:${managed.metadata.height}`,
          resultKind: 'layer-stack',
          layerStackDocument: legacyDocument,
          isGenerating: false,
        },
      })
      edges.push({
        id: '__ui_multi_layer_document_edge',
        source: '__ui_panorama_source',
        target: nodeId,
        sourceHandle: 'source',
        targetHandle: 'target',
      })
      edges.push({
        id: '__ui_multi_layer_legacy_edge',
        source: '__ui_panorama_source',
        target: legacyNodeId,
        sourceHandle: 'source',
        targetHandle: 'target',
      })
      await window.henjiNative.db.execute(
        'UPDATE storyboard_projects SET node_count = ?, nodes_json = ?, edges_json = ?, viewport_json = ? WHERE id = ?',
        [
          nodes.length,
          JSON.stringify(nodes),
          JSON.stringify(edges),
          JSON.stringify({ x: 50, y: 120, zoom: 0.7 }),
          targetProjectId,
        ]
      )
      return {
        documentRef: saved.documentRef,
        initialRevision: saved.revision,
        nodeId,
        legacyNodeId,
        expectedNodeCount: nodes.length,
      }
    }, { targetProjectId: projectId, source: panoramaSource })

    const verifiedDrag = await verifyMultiLayerDragPerformance({
      page,
      projectId,
      fixture,
      settlePage,
      inspection,
    })
    console.log(`[image-editor-gpu-baseline] ${JSON.stringify({
      fixture: 'kie-five-layer',
      path: 'dom-raster-pasteboard',
      ...verifiedDrag.dragBaseline,
    })}`)
    const initialPreviewSource = verifiedDrag.initialPreviewSource
    const result = verifiedDrag.result
    let dialog = verifiedDrag.dialog
    let editor = verifiedDrag.editor
    const exportButton = dialog.getByRole('button', { name: /导出到画布|Export to canvas/i })
    await exportButton.waitFor({ state: 'visible', timeout: 8000 })
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => (
      /导出到画布|Export to canvas/i.test(button.textContent ?? '') && !button.disabled
    )), undefined, { timeout: 8000 })
    await exportButton.click()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => (
      /^(导出到画布|Export to canvas)$/i.test(button.textContent?.trim() ?? '') && !button.disabled
    )), undefined, { timeout: 60000 })
    if (!(await dialog.isVisible())) throw new Error('导出图层后多图层图片编辑器被意外关闭')
    await settlePage(page, 900)
    const exportEvidence = await page.evaluate(async ({ targetProjectId, sourceNodeId, documentRef }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const sourceNode = nodes.find((candidate) => candidate.id === sourceNodeId)
      const exportedNodes = nodes.filter((candidate) => (
        candidate.type === 'exportImageNode'
        && candidate.data?.resultKind === 'image'
        && edges.some((edge) => edge.source === sourceNodeId && edge.target === candidate.id)
      ))
      const loaded = await window.henjiNative.imageEditorV3.loadDocument({
        requestId: `reality-multi-layer-export-check-${crypto.randomUUID()}`,
        documentRef,
      })
      return {
        nodeCount: nodes.length,
        exportedCount: exportedNodes.length,
        ordinary: exportedNodes.every((candidate) => (
          typeof candidate.data?.imageUrl === 'string'
          && candidate.data.imageUrl.length > 0
          && typeof candidate.data?.previewImageUrl === 'string'
          && candidate.data.previewImageUrl.length > 0
          && typeof candidate.data?.aspectRatio === 'string'
          && typeof candidate.data?.displayName === 'string'
          && !candidate.data.imageEditSession
          && !candidate.data.layerStackDocument
        )),
        sourceRevision: sourceNode?.data?.imageEditSession?.revision,
        documentRevision: loaded?.revision,
        layerVisibility: loaded?.document?.layers?.map((layer) => layer.visible),
      }
    }, {
      targetProjectId: projectId,
      sourceNodeId: fixture.nodeId,
      documentRef: fixture.documentRef,
    })
    if (exportEvidence.nodeCount !== fixture.expectedNodeCount + 1
      || exportEvidence.exportedCount !== 1
      || !exportEvidence.ordinary
      || exportEvidence.sourceRevision !== fixture.initialRevision
      || exportEvidence.documentRevision !== fixture.initialRevision + 1
      || exportEvidence.layerVisibility?.some((visible) => visible !== true)) {
      throw new Error(`多图层目标没有原子导出为普通图片节点：${JSON.stringify(exportEvidence)}`)
    }

    await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 12000 })
    await result.getByRole('button', { name: /^(编辑|Edit)$/i }).click()
    dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    editor = dialog.locator('[data-image-editor-v3]')
    await editor.waitFor({ state: 'visible', timeout: 15000 })
    await editor.getByText('前景元素').waitFor({ state: 'visible', timeout: 8000 })
    if (await dialog.locator('[data-command-bar]').count() !== 1) {
      throw new Error('多图层图片文档重开后不是唯一命令带')
    }
    await verifyHiddenBackgroundRasterStack({
      page,
      editor,
      expectedRevision: fixture.initialRevision + 2,
    })
    await page.waitForTimeout(700)
    const persistedRevision = await page.evaluate(async (documentRef) => {
      const loaded = await window.henjiNative.imageEditorV3.loadDocument({
        requestId: `reality-multi-layer-load-${crypto.randomUUID()}`,
        documentRef,
      })
      return loaded?.revision ?? -1
    }, fixture.documentRef)
    if (persistedRevision !== fixture.initialRevision + 2) {
      throw new Error(`多图层文档编辑没有实时保存：${persistedRevision}`)
    }
    await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 60000 })
    await page.waitForFunction(({ selector, previous }) => {
      const image = document.querySelector(`${selector} img[alt="多图层图片预览"]`)
      return image instanceof HTMLImageElement && image.getAttribute('src') !== previous
    }, {
      selector: `[data-layer-stack-node-id="${fixture.nodeId}"]`,
      previous: initialPreviewSource,
    }, { timeout: 30000 })
    const materializedPreviewSource = await result.locator('img[alt="多图层图片预览"]').getAttribute('src')
    if (!materializedPreviewSource || materializedPreviewSource === initialPreviewSource) {
      throw new Error('关闭编辑器后同一节点没有切换到最新合成图预览')
    }

    await settlePage(page, 900)
    const persistedProjection = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json, history_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const history = JSON.parse(rows[0]?.history_json ?? '{}')
      const node = nodes.find((candidate) => candidate.id === targetNodeId)
      const imageRef = String(node?.data?.imageUrl ?? '')
      const imageIndex = imageRef.startsWith('__img_ref__:')
        ? Number.parseInt(imageRef.slice('__img_ref__:'.length), 10)
        : -1
      return {
        nodeCount: nodes.length,
        matchingNodeCount: nodes.filter((candidate) => candidate.id === targetNodeId).length,
        position: node?.position,
        revision: node?.data?.imageEditSession?.revision,
        previewRef: node?.data?.imageEditSession?.previewRef,
        sourceUrl: node?.data?.imageEditSession?.sourceUrl,
        imageRef,
        persistedImageUrl: history.imagePool?.[imageIndex] ?? null,
        previewImageRef: node?.data?.previewImageUrl,
        sourceEdges: edges.filter((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId).length,
      }
    }, { targetProjectId: projectId, targetNodeId: fixture.nodeId })
    if (persistedProjection.matchingNodeCount !== 1
      || persistedProjection.nodeCount !== fixture.expectedNodeCount + 1
      || persistedProjection.position?.x !== 720
      || persistedProjection.position?.y !== 80
      || persistedProjection.revision !== fixture.initialRevision + 2
      || typeof persistedProjection.previewRef !== 'string'
      || persistedProjection.sourceUrl !== persistedProjection.persistedImageUrl
      || persistedProjection.previewImageRef !== persistedProjection.imageRef
      || persistedProjection.sourceEdges !== 1) {
      throw new Error(`多图层文档节点投影没有原位、原子持久化：${JSON.stringify(persistedProjection)}`)
    }

    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 600)
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const reopenedResult = page.locator(
      `[data-layer-stack-node-id="${fixture.nodeId}"][data-layer-stack-status="editable-v3"]`
    )
    await reopenedResult.waitFor({ state: 'visible', timeout: 12000 })
    if (await reopenedResult.locator('img[alt="多图层图片预览"]').getAttribute('src') !== materializedPreviewSource) {
      throw new Error('项目保存重开后节点预览没有恢复最新合成图')
    }
    await reopenedResult.getByRole('button', { name: /^(编辑|Edit)$/i }).click()
    dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    editor = dialog.locator('[data-image-editor-v3]')
    await editor.waitFor({ state: 'visible', timeout: 15000 })
    await editor.getByRole('button', { name: /显示.*背景图层|Show.*Background/i }).waitFor({
      state: 'visible',
      timeout: 8000,
    })
    await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 60000 })

    const legacyResult = page.locator(
      `[data-layer-stack-node-id="${fixture.legacyNodeId}"]`
    )
    await legacyResult.waitFor({ state: 'visible', timeout: 12000 })
    const narrowViewport = await page.evaluate(() => window.outerWidth <= 1000)
    const clickLegacyEdit = async () => {
      const editButton = legacyResult.getByRole('button', { name: /^(编辑|Edit)$/i })
      if (narrowViewport) {
        await editButton.evaluate((button) => button.click())
        return
      }
      await editButton.click()
    }
    await clickLegacyEdit()
    dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
    await dialog.waitFor({ state: 'visible', timeout: 30000 })
    if (await page.getByRole('dialog', { name: /^图层\s*·|^Layers\s*·/i }).count()) {
      throw new Error('旧 V1 节点仍打开轻量图层弹窗')
    }
    await dialog.locator('[data-image-editor-v3]').getByText('旧版底图').waitFor({
      state: 'visible',
      timeout: 15000,
    })
    await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 60000 })
    await settlePage(page, 700)
    const firstLegacyMigration = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const node = nodes.find((candidate) => candidate.id === targetNodeId)
      return {
        documentRef: node?.data?.imageEditSession?.documentRef,
        revision: node?.data?.imageEditSession?.revision,
        keptLegacyV1: node?.data?.layerStackDocument?.version === 1,
      }
    }, { targetProjectId: projectId, targetNodeId: fixture.legacyNodeId })
    if (!String(firstLegacyMigration.documentRef ?? '').startsWith('image-edit-v3:')
      || !firstLegacyMigration.keptLegacyV1) {
      throw new Error(`旧 V1 节点没有迁移为可编辑 V3 文档：${JSON.stringify(firstLegacyMigration)}`)
    }
    await clickLegacyEdit()
    dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 60000 })
    await settlePage(page, 700)
    const secondLegacyMigration = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      return nodes.find((candidate) => candidate.id === targetNodeId)?.data?.imageEditSession ?? null
    }, { targetProjectId: projectId, targetNodeId: fixture.legacyNodeId })
    if (secondLegacyMigration?.documentRef !== firstLegacyMigration.documentRef) {
      throw new Error(`旧 V1 节点二次打开重复创建文档：${JSON.stringify({ firstLegacyMigration, secondLegacyMigration })}`)
    }

    await reopenedResult.click()
    await page.keyboard.press('Meta+c')
    await page.keyboard.press('Meta+v')
    await page.waitForFunction(() => (
      document.querySelectorAll('[data-layer-stack-status="editable-v3"]').length >= 3
    ), undefined, { timeout: 30000 })
    const duplicateNodeId = await page.locator('[data-layer-stack-status="editable-v3"]')
      .evaluateAll((elements, knownIds) => elements
        .map((element) => element.getAttribute('data-layer-stack-node-id'))
        .find((nodeId) => nodeId && !knownIds.includes(nodeId)) ?? null, [fixture.nodeId, fixture.legacyNodeId])
    if (!duplicateNodeId) throw new Error('复制后无法从正式画布节点识别新节点')
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 700)
    const duplicateEvidence = await page.evaluate(async ({ targetProjectId, sourceNodeId, duplicateNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const sourceNode = nodes.find((candidate) => candidate.id === sourceNodeId)
      const duplicate = nodes.find((candidate) => candidate.id === duplicateNodeId)
      return {
        duplicateNodeId: duplicate?.id,
        sourceDocumentRef: sourceNode?.data?.imageEditSession?.documentRef,
        duplicateDocumentRef: duplicate?.data?.imageEditSession?.documentRef,
      }
    }, {
      targetProjectId: projectId,
      sourceNodeId: fixture.nodeId,
      duplicateNodeId,
    })
    if (!duplicateEvidence.duplicateNodeId
      || !duplicateEvidence.duplicateDocumentRef
      || duplicateEvidence.duplicateDocumentRef === duplicateEvidence.sourceDocumentRef) {
      throw new Error(`复制节点没有获得独立文档：${JSON.stringify(duplicateEvidence)}`)
    }
    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    const duplicateResult = page.locator(
      `[data-layer-stack-node-id="${duplicateEvidence.duplicateNodeId}"]`
    )
    await duplicateResult.waitFor({ state: 'visible', timeout: 15000 })
    const selectDuplicateResult = () => selectOverlappingReactFlowNode({
      page,
      nodeContent: duplicateResult,
      nodeId: duplicateEvidence.duplicateNodeId,
    })
    await selectDuplicateResult()
    await duplicateResult.getByRole('button', { name: /^(编辑|Edit)$/i }).click()
    dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
    await dialog.waitFor({ state: 'visible', timeout: 15000 })
    editor = dialog.locator('[data-image-editor-v3]')
    await editor.getByRole('button', { name: /隐藏.*前景元素|Hide.*Foreground/i }).click()
    await page.waitForTimeout(700)
    await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 60000 })
    const forkIsolation = await page.evaluate(async ({ sourceDocumentRef, duplicateDocumentRef }) => {
      const [source, duplicate] = await Promise.all([
        window.henjiNative.imageEditorV3.loadDocument({
          requestId: `reality-source-isolation-${crypto.randomUUID()}`,
          documentRef: sourceDocumentRef,
        }),
        window.henjiNative.imageEditorV3.loadDocument({
          requestId: `reality-duplicate-isolation-${crypto.randomUUID()}`,
          documentRef: duplicateDocumentRef,
        }),
      ])
      return {
        sourceVisibility: source?.document?.layers?.map((layer) => layer.visible),
        duplicateVisibility: duplicate?.document?.layers?.map((layer) => layer.visible),
      }
    }, {
      sourceDocumentRef: duplicateEvidence.sourceDocumentRef,
      duplicateDocumentRef: duplicateEvidence.duplicateDocumentRef,
    })
    if (JSON.stringify(forkIsolation.sourceVisibility) !== JSON.stringify([false, true, true, true, true])
      || JSON.stringify(forkIsolation.duplicateVisibility) !== JSON.stringify([false, true, true, true, false])) {
      throw new Error(`复制文档编辑互相污染：${JSON.stringify(forkIsolation)}`)
    }

    await selectDuplicateResult()
    await page.keyboard.press('Delete')
    await duplicateResult.waitFor({ state: 'hidden', timeout: 15000 })
    await page.keyboard.press('Meta+z')
    await duplicateResult.waitFor({ state: 'visible', timeout: 15000 })
    await page.keyboard.press('Meta+Shift+z')
    await duplicateResult.waitFor({ state: 'hidden', timeout: 15000 })
    const redoDocumentStillRecoverable = await page.evaluate(async (documentRef) => {
      const loaded = await window.henjiNative.imageEditorV3.loadDocument({
        requestId: `reality-redo-candidate-${crypto.randomUUID()}`,
        documentRef,
      })
      return loaded?.documentRef ?? null
    }, duplicateEvidence.duplicateDocumentRef)
    if (redoDocumentStillRecoverable !== duplicateEvidence.duplicateDocumentRef) {
      throw new Error('删除→撤销→重做错误清理了仍受历史保护的文档')
    }

    const packageRoundTrip = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json, viewport_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const sourceNode = nodes.find((candidate) => candidate.id === targetNodeId)
      const session = sourceNode?.data?.imageEditSession
      const tempRoot = await window.henjiNative.paths.tempDir()
      const packagePath = await window.henjiNative.paths.join(
        tempRoot,
        `multi-layer-document-${crypto.randomUUID()}.henjiproj`
      )
      const manifest = {
        formatVersion: 2,
        app: 'henji-ai',
        nodes: [sourceNode],
        edges: [],
        viewport: JSON.parse(rows[0]?.viewport_json ?? '{"x":0,"y":0,"zoom":1}'),
        imageEditorV3: {
          version: 1,
          bundlePath: 'image-editor-v3/manifest.json',
          documents: [{
            documentRef: session.documentRef,
            revision: session.revision,
            previewRef: session.previewRef,
          }],
        },
      }
      await window.henjiNative.projectPackage.exportProjectPackage(
        JSON.stringify(manifest),
        [],
        packagePath
      )
      const imported = await window.henjiNative.projectPackage.importProjectPackage(packagePath)
      const mapping = imported.imageEditReferences?.[0]
      const importedDocument = mapping
        ? await window.henjiNative.imageEditorV3.loadDocument({
            requestId: `reality-package-import-${crypto.randomUUID()}`,
            documentRef: mapping.imported.documentRef,
          })
        : null
      await window.henjiNative.fs.remove(packagePath)
      return {
        sourceDocumentRef: session.documentRef,
        importedDocumentRef: mapping?.imported?.documentRef,
        sourceRevision: mapping?.source?.revision,
        importedRevision: mapping?.imported?.revision,
        importedLayerCount: importedDocument?.document?.layers?.length,
      }
    }, { targetProjectId: projectId, targetNodeId: fixture.nodeId })
    if (!packageRoundTrip.importedDocumentRef
      || packageRoundTrip.importedDocumentRef === packageRoundTrip.sourceDocumentRef
      || packageRoundTrip.sourceRevision !== fixture.initialRevision + 2
      || packageRoundTrip.importedRevision !== fixture.initialRevision + 2
      || packageRoundTrip.importedLayerCount !== 5) {
      throw new Error(`多图层文档项目包往返失败：${JSON.stringify(packageRoundTrip)}`)
    }
    await settlePage(page, 900)
  }

  async function setupCanvasNineGrid(page) {
    const { projectId } = await seedAndOpenCanvasPanoramaProject(page)
    const sourceNode = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
    await sourceNode.click()
    await page.waitForTimeout(350)

    await clickCanvasCapabilityAction(page, {
      directName: /^(九宫格|Nine-grid)$/i,
      menuName: /^(九宫格|Nine-grid)(?:\s|$)/i,
      missingMessage: '九宫格工具入口不可见',
    })

    const presetShell = page.locator('[data-storyboard-preset="nine-grid-v1"]').last()
    await presetShell.waitFor({ state: 'visible', timeout: 12000 })
    const storyboardNode = presetShell.locator('xpath=ancestor::*[contains(@class,"react-flow__node")][1]')
    const storyboardNodeId = await storyboardNode.getAttribute('data-id')
    if (!storyboardNodeId || storyboardNodeId === '__ui_panorama_source') {
      throw new Error('九宫格入口未复用现有分镜生成节点创建相邻预设')
    }
    if (!(await storyboardNode.evaluate((element) => element.classList.contains('selected')))) {
      throw new Error('九宫格入口创建后未选中新节点')
    }
    await presetShell.getByText(/固定 3×3/).waitFor({ state: 'visible', timeout: 8000 })
    for (const label of ['行数减少', '行数增加', '列数减少', '列数增加']) {
      const control = presetShell.getByRole('button', { name: label })
      if (!(await control.isDisabled())) throw new Error(`固定九宫格仍允许修改：${label}`)
    }
    if (await page.locator('.react-flow__edge').count() < 1) throw new Error('九宫格工具条未创建源图连线')

    // 不触发任何供应商请求；在同一真实 Electron 场景中执行现有本地宫格切分。
    await sourceNode.click()
    await page.waitForTimeout(350)
    await clickCanvasCapabilityAction(page, {
      directName: /^(宫格切分|Grid Split)$/i,
      menuName: /^(宫格切分|Grid Split)(?:\s|$)/i,
      missingMessage: '宫格切分工具入口不可见',
    })
    const splitDialog = page.getByRole('dialog', { name: /切割工具|Split.*tool/i })
    await splitDialog.waitFor({ state: 'visible', timeout: 12000 })
    await splitDialog.getByText(/输出小格数量/).waitFor({ state: 'visible', timeout: 8000 })
    await splitDialog.getByText('9', { exact: true }).last().waitFor({ state: 'visible', timeout: 8000 })
    await splitDialog.getByRole('button', { name: /^(应用|Apply)$/i }).click()
    await splitDialog.waitFor({ state: 'hidden', timeout: 30000 })

    const group = page.locator('.react-flow__node').filter({ hasText: /宫格切分 · 3×3/ }).last()
    await group.waitFor({ state: 'visible', timeout: 30000 })
    await group.locator('[data-asset-group-preview-count="9"]').waitFor({ state: 'visible', timeout: 12000 })

    await page.waitForTimeout(900)
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await settlePage(page, 500)
    const persisted = await page.evaluate(async ({ targetProjectId, targetNodeId }) => {
      const rows = await window.henjiNative.db.select(
        'SELECT nodes_json, edges_json FROM storyboard_projects WHERE id = ? LIMIT 1',
        [targetProjectId]
      )
      const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
      const edges = JSON.parse(rows[0]?.edges_json ?? '[]')
      const target = nodes.find((candidate) => candidate.id === targetNodeId)
      const groups = nodes.filter((candidate) => candidate.type === 'assetGroupNode')
      const splitGroup = groups.find((candidate) => candidate.data?.displayName === '宫格切分 · 3×3')
      const members = splitGroup ? nodes.filter((candidate) => candidate.parentId === splitGroup.id) : []
      return {
        nodeType: target?.type,
        capabilityId: target?.data?.capabilityId,
        preset: target?.data?.storyboardPreset,
        templateVersion: target?.data?.promptTemplateVersion,
        rows: target?.data?.gridRows,
        cols: target?.data?.gridCols,
        frameCount: target?.data?.frames?.length,
        hasSourceEdge: edges.some((edge) => edge.source === '__ui_panorama_source' && edge.target === targetNodeId),
        groupCount: groups.length,
        memberCount: members.length,
        memberOrderCount: splitGroup?.data?.memberOrder?.length,
      }
    }, { targetProjectId: projectId, targetNodeId: storyboardNodeId })
    if (persisted.nodeType !== 'storyboardGenNode'
      || persisted.capabilityId !== 'image.nine-grid'
      || persisted.preset !== 'nine-grid-v1'
      || persisted.templateVersion !== 'nine-grid-storyboard-v1'
      || persisted.rows !== 3
      || persisted.cols !== 3
      || persisted.frameCount !== 9
      || !persisted.hasSourceEdge
      || persisted.groupCount !== 1
      || persisted.memberCount !== 9
      || persisted.memberOrderCount !== 9) {
      throw new Error(`九宫格或宫格切分保存语义丢失：${JSON.stringify(persisted)}`)
    }

    await page.locator(`[data-project-id="${projectId}"]:visible`).click()
    await page.locator(`[data-storyboard-preset="nine-grid-v1"]`).waitFor({ state: 'visible', timeout: 12000 })
    await page.locator('[data-asset-group-preview-count="9"]').waitFor({ state: 'visible', timeout: 12000 })
    await page.mouse.move(1200, 700)
    await settlePage(page, 900)
  }

  Object.assign(context, {
    setupCanvasElementEditNode,
    setupCanvasMultiLayerDocumentEditor,
    setupCanvasNineGrid,
  })
}

module.exports = { attachUiInspectionCanvasEditing }
