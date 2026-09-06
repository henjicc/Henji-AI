const { runContinuousGpuDrag, waitForVisibleFixtureColors, isGpuSurfaceReady } = require('./uiInspectionGpuDragEvidence.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

async function readDragPersistenceEvidence(page, payload) {
  return page.evaluate(async ({ afterTimestamp, documentRef, documentId, revision, projectId, nodeId }) => {
    // 先按正式事件过滤，再限量；频繁 load.completed 不能挤掉首次真实保存。
    const result = await window.henjiNative.logging.queryLogEvents({
      date: afterTimestamp.slice(0, 10), afterTimestamp, level: 'info',
      domainPrefix: 'main.image_editor_v3.documents',
      keyword: 'image_editor_v3.document.save.completed', limit: 20,
    })
    if (result.hasMore) throw new Error('本次保存事件超出有界证据范围，不能据截断结果报告只保存一次')
    const loaded = await window.henjiNative.imageEditorV3.loadDocument({
      requestId: `reality-multi-layer-post-drag-${crypto.randomUUID()}`, documentRef,
    })
    const rows = await window.henjiNative.db.select('SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1', [projectId])
    const node = JSON.parse(rows[0]?.nodes_json ?? '[]').find((value) => value.id === nodeId)
    return {
      repositorySaveCount: result.events.filter((event) => event.event === 'image_editor_v3.document.save.completed'
        && event.context?.documentId === documentId && event.context?.revision === revision).length,
      persistedDocumentId: loaded?.document?.id,
      persistedRevision: loaded?.revision ?? -1,
      persistedTransform: loaded?.document?.layers.find((layer) => layer.id === 'ui-foreground-layer')?.transform,
      nodeDocumentRef: node?.data?.imageEditSession?.documentRef,
      nodeRevision: node?.data?.imageEditSession?.revision,
    }
  }, payload)
}

function isDragPersistenceConfirmed(evidence, { documentId, documentRef, revision, initialRevision }) {
  // UI 自动保存只写文档；关闭才物化预览并更新画布节点，不能要求每次 pointerup 保存画布。
  return evidence.repositorySaveCount === 1 && evidence.persistedDocumentId === documentId
    && evidence.persistedRevision === revision && evidence.nodeDocumentRef === documentRef
    && evidence.nodeRevision === initialRevision
}

async function waitForEditorState(page, { message, read, accept, timeout = 30000 }) {
  const startedAt = Date.now()
  let lastEvidence = null
  while (Date.now() - startedAt < timeout) {
    lastEvidence = await read()
    if (accept(lastEvidence)) return lastEvidence
    await page.waitForTimeout(80)
  }
  throw new Error(`${message}：${JSON.stringify(lastEvidence)}`)
}

async function readPasteboardDiagnostic(page, documentRef) {
  return page.evaluate(async ({ targetDocumentRef }) => {
    const loaded = await window.henjiNative.imageEditorV3.loadDocument({
      requestId: `reality-multi-layer-pasteboard-diagnostic-${crypto.randomUUID()}`,
      documentRef: targetDocumentRef,
    })
    const resourceRefs = new Set((loaded?.document?.layers ?? [])
      .filter((layer) => layer.type === 'raster' && layer.source?.kind === 'resource')
      .map((layer) => layer.source.resourceId))
    const editorRoots = [...document.querySelectorAll('[data-image-editor-v3]')]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
    const currentEditor = editorRoots.at(-1)
    const preview = currentEditor?.querySelector('[data-preview-surface]')
    return {
      visibleEditorCount: editorRoots.length,
      documentLayerCount: loaded?.document?.layers?.length ?? null,
      visibleLayerCount: loaded?.document?.layers?.filter((layer) => layer.visible).length ?? null,
      resources: (loaded?.resources ?? []).map((resource) => ({
        mediaType: resource.mediaType,
        byteLengthPositive: Number(resource.byteLength) > 0,
        matchesRasterLayer: resourceRefs.has(resource.resourceRef),
      })),
      preview: {
        moveAvailability: preview?.getAttribute('data-move-availability') ?? null,
        coverage: preview?.getAttribute('data-preview-coverage') ?? null,
        rasterStackAttached: currentEditor
          ?.querySelectorAll('[data-raster-pasteboard-stack="multi"]').length ?? 0,
      },
    }
  }, { targetDocumentRef: documentRef })
}

async function verifyMultiLayerDragPerformance({
  page,
  app,
  projectId,
  fixture,
  inspection,
}) {
  await page.locator(`[data-project-id="${projectId}"]:visible`).click()
  const result = page.locator(
    `[data-layer-stack-node-id="${fixture.nodeId}"][data-layer-stack-status="editable-v3"]`
  )
  await result.waitFor({ state: 'visible', timeout: 12000 })
  const initialPreviewSource = await result.locator('img[alt="多图层图片预览"]').getAttribute('src')
  await result.click()
  await page.waitForTimeout(250)
  if (await page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i }).count()) {
    throw new Error('多图层图片文档节点单击不应打开编辑器')
  }

  await result.dblclick()
  const dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
  await dialog.waitFor({ state: 'visible', timeout: 15000 })
  const editor = dialog.locator('[data-image-editor-v3]')
  await editor.waitFor({ state: 'visible', timeout: 15000 })
  const firstOpenEvidence = await page.evaluate(async ({ targetProjectId, targetNodeId, documentRef }) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
      [targetProjectId]
    )
    const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
    const node = nodes.find((candidate) => candidate.id === targetNodeId)
    const loaded = await window.henjiNative.imageEditorV3.loadDocument({
      requestId: `reality-multi-layer-first-open-${crypto.randomUUID()}`,
      documentRef,
    })
    return {
      nodeDocumentRef: node?.data?.imageEditSession?.documentRef,
      nodeRevision: node?.data?.imageEditSession?.revision,
      loadedDocumentRef: loaded?.documentRef,
      loadedRevision: loaded?.revision,
      documentId: loaded?.document?.id,
      initialTransform: loaded?.document?.layers.find((layer) => layer.id === 'ui-foreground-layer')?.transform,
      geometry: loaded?.document?.geometry,
    }
  }, {
    targetProjectId: projectId,
    targetNodeId: fixture.nodeId,
    documentRef: fixture.documentRef,
  })
  if (firstOpenEvidence.nodeDocumentRef !== fixture.documentRef
    || firstOpenEvidence.loadedDocumentRef !== fixture.documentRef
    || firstOpenEvidence.nodeRevision !== fixture.initialRevision
    || firstOpenEvidence.loadedRevision !== fixture.initialRevision) {
    throw new Error(`首次打开创建了第二份文档或改写了版本：${JSON.stringify(firstOpenEvidence)}`)
  }
  const structure = await dialog.evaluate((root) => ({
    commandBars: root.querySelectorAll('[data-command-bar]').length,
    contextBars: root.querySelectorAll('[data-context-bar]').length,
    internalText: /revision|documentRef|资源 ID|队列|版本\s*\d+/i.test(root.textContent ?? ''),
    saveOrApply: [...root.querySelectorAll('button')]
      .some((button) => /^(保存|应用|Save|Apply)$/i.test(button.textContent?.trim() ?? '')),
  }))
  if (structure.commandBars !== 1
    || structure.contextBars !== 0
    || structure.internalText
    || structure.saveOrApply) {
    throw new Error(`多图层文档编辑器界面结构不符合约束：${JSON.stringify(structure)}`)
  }
  await waitForEditorState(page, {
    message: '多图层稳定预览没有就绪',
    read: async () => ({
      loading: await editor.locator('.animate-spin').count(),
      coverage: Number(await editor.locator('[data-preview-surface]')
        .getAttribute('data-preview-coverage') ?? '0'),
    }),
    accept: ({ loading, coverage }) => loading === 0 && Number.isFinite(coverage) && coverage > 0,
    timeout: 60000,
  })
  const commandBar = editor.locator('[data-command-bar]')
  const rasterStack = editor.locator('[data-raster-pasteboard-stack="multi"]')
  await editor.locator('[data-layer-id="ui-foreground-layer"] [data-layer-select]').click()
  await waitForEditorState(page, {
    message: '多图层移动工具没有就绪',
    read: () => editor.locator('[data-preview-surface]').getAttribute('data-move-availability'),
    accept: (availability) => availability === 'ready',
    timeout: 10000,
  })
  const previewSurface = editor.locator('[data-preview-surface]')
  await waitForEditorState(page, {
    message: '五层场景没有交给 WebGPU Surface 稳定呈现',
    read: async () => ({
      composition: await previewSurface.getAttribute('data-preview-composition-backend'),
      presentation: await previewSurface.getAttribute('data-preview-presentation-backend'),
      visible: await editor.locator('[data-presentation-gpu-surface]')
        .evaluate((element) => getComputedStyle(element).visibility === 'visible'),
      coverage: Number(await previewSurface.getAttribute('data-preview-coverage')),
      frameCount: Number(await editor.locator('[data-presentation-front-surface]')
        .getAttribute('data-gpu-frame-count') ?? '0'),
      surfaceFrameCount: Number(await editor.locator('[data-presentation-front-surface]')
        .getAttribute('data-gpu-surface-frame-count') ?? '0'),
      imageBitmapFrameCount: Number(await editor.locator('[data-presentation-front-surface]')
        .getAttribute('data-gpu-image-bitmap-frame-count') ?? '-1'),
    }),
    accept: isGpuSurfaceReady,
    timeout: 30000,
  }).catch(async (error) => {
    const diagnostic = await readPasteboardDiagnostic(page, fixture.documentRef)
    throw new Error(`${error instanceof Error ? error.message : String(error)}；诊断：${JSON.stringify(diagnostic)}`)
  })
  const contentBox = await editor.locator('[data-viewport-content]').boundingBox()
  if (!contentBox) throw new Error('多图层拖动前无法读取真实画面区域')
  if (fixture.expectedColors) await waitForVisibleFixtureColors(
    page, () => captureInspectionPage(app ?? inspection?.electronApp, page, { clip: contentBox }), fixture.expectedColors,
  )
  await inspection?.capture?.('editor')
  const beforeLayerMove = Number(await commandBar.getAttribute('data-document-revision'))
  if (beforeLayerMove !== fixture.initialRevision) throw new Error('拖动前文档版本异常')
  const stableRaster = editor.locator('[data-raster-display-frame]')
  const dragStartedAt = new Date().toISOString()
  const dragMetrics = await runContinuousGpuDrag({ page, app: app ?? inspection?.electronApp,
    editor, box: contentBox })
  const expectedTransform = [...firstOpenEvidence.initialTransform]
  expectedTransform[4] += (dragMetrics.finalPoint.x - dragMetrics.start.x) / contentBox.width * firstOpenEvidence.geometry.width
  expectedTransform[5] += (dragMetrics.finalPoint.y - dragMetrics.start.y) / contentBox.height * firstOpenEvidence.geometry.height
  await waitForEditorState(page, {
    message: '多图层移动松手后没有只提交一个 revision',
    read: async () => Number(await commandBar.getAttribute('data-document-revision')),
    accept: (revision) => revision === beforeLayerMove + 1,
    timeout: 12000,
  })
  await waitForEditorState(page, {
    message: '多图层移动提交后没有清除手势残差并交回稳定合成',
    read: async () => ({
      stackVisibility: await rasterStack.count()
        ? await rasterStack.evaluate((element) => getComputedStyle(element).visibility)
        : 'absent',
      stableVisibility: await stableRaster.evaluate((element) => getComputedStyle(element).visibility),
      gpuVisibility: await editor.locator('[data-presentation-gpu-surface]')
        .evaluate((element) => getComputedStyle(element).visibility),
      composition: await previewSurface.getAttribute('data-preview-composition-backend'),
      presentation: await previewSurface.getAttribute('data-preview-presentation-backend'),
    }),
    accept: (evidence) => ['hidden', 'absent'].includes(evidence.stackVisibility)
      && evidence.stableVisibility === 'visible' && evidence.gpuVisibility === 'visible'
      && evidence.composition === 'gpu' && evidence.presentation === 'webgpu-surface',
  })
  const saveEvidence = await waitForEditorState(page, {
    message: 'GPU 移动松手后没有完成一次保存/一次 revision',
    read: () => readDragPersistenceEvidence(page, { afterTimestamp: dragStartedAt,
      documentRef: fixture.documentRef, documentId: firstOpenEvidence.documentId,
      revision: beforeLayerMove + 1, projectId, nodeId: fixture.nodeId }),
    accept: (evidence) => isDragPersistenceConfirmed(evidence, { documentId: firstOpenEvidence.documentId,
      documentRef: fixture.documentRef, revision: beforeLayerMove + 1, initialRevision: fixture.initialRevision }),
    timeout: 12000,
  })
  if (!saveEvidence.persistedTransform || saveEvidence.persistedTransform.some((value, index) => (
    Math.abs(value - expectedTransform[index]) > 1e-4
  ))) throw new Error(`保存的 transform 不是末次反向输入：${JSON.stringify({ expectedTransform, saveEvidence })}`)
  const rendererSize = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  return {
    dialog, editor, initialPreviewSource, result,
    dragBaseline: {
      ...dragMetrics,
      saveEvidence,
      requestedWindowSize: inspection?.requestedWindowSize ?? fixture.windowSize ?? null,
      rendererSize,
    },
  }
}

async function verifyHiddenBackgroundRasterStack({ page, editor, expectedRevision, allowAbsent = false }) {
  await editor.getByRole('button', { name: /隐藏.*背景图层|Hide.*Background/i }).click()
  const commandBar = editor.locator('[data-command-bar]')
  await waitForEditorState(page, {
    message: '隐藏背景后没有提交一个 revision',
    read: async () => Number(await commandBar.getAttribute('data-document-revision')),
    accept: (revision) => revision === expectedRevision,
    timeout: 10000,
  })
  const rasterStack = editor.locator('[data-raster-pasteboard-stack="multi"]')
  if (!allowAbsent) await rasterStack.waitFor({ state: 'attached', timeout: 10000 })
  await waitForEditorState(page, {
    message: '隐藏背景后没有保留前景资源代理栈',
    read: async () => {
      const attached = await rasterStack.count()
      return {
        ready: attached ? await rasterStack.getAttribute('data-raster-source-ready') : null,
        layers: attached ? await rasterStack.locator('[data-raster-pasteboard-layer]').count() : 0,
        foreground: attached ? await rasterStack
          .locator('[data-raster-pasteboard-layer="ui-foreground-layer"]').count() : 0,
      }
    },
    accept: ({ ready, layers, foreground }) => allowAbsent
      ? (ready === null && layers === 0 && foreground === 0)
      : (ready === 'true' && layers === 4 && foreground === 1),
    timeout: 10000,
  })
}

async function selectOverlappingReactFlowNode({ page, nodeContent, nodeId }) {
  const outerNode = page.locator(`.react-flow__node[data-id="${nodeId}"]`)
  // 固定偏移的复制节点可能与源节点重叠；DOM click 保留冒泡语义且不受下层图片命中测试影响。
  await nodeContent.evaluate((element) => element.click())
  if (!(await outerNode.evaluate((element) => element.classList.contains('selected')))) {
    await outerNode.evaluate((element) => element.click())
  }
  await page.waitForFunction((targetNodeId) => (
    document.querySelector(`.react-flow__node[data-id="${targetNodeId}"]`)
      ?.classList.contains('selected')
  ), nodeId, { timeout: 8000 })
}

module.exports = {
  readDragPersistenceEvidence,
  isDragPersistenceConfirmed,
  selectOverlappingReactFlowNode,
  verifyHiddenBackgroundRasterStack,
  verifyMultiLayerDragPerformance,
}
