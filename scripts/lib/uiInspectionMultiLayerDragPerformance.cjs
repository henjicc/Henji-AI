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

function percentile(samples, quantile) {
  const sorted = [...samples].sort((left, right) => left - right)
  return Number((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))] ?? 0).toFixed(3))
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
  projectId,
  fixture,
  settlePage,
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
  await settlePage(page, 350)
  await inspection?.capture?.('editor')

  const commandBar = editor.locator('[data-command-bar]')
  const rasterStack = editor.locator('[data-raster-pasteboard-stack="multi"]')
  if (!fixture.complexGraph) {
    try {
      await waitForEditorState(page, {
        message: '多图层资源代理栈没有就绪',
        read: async () => {
          const attached = await rasterStack.count()
          return {
            attached,
            ready: attached ? await rasterStack.getAttribute('data-raster-source-ready') : null,
            layers: attached
              ? await rasterStack.locator('[data-raster-pasteboard-layer]').count()
              : 0,
          }
        },
        accept: ({ attached, ready, layers }) => attached === 1 && ready === 'true' && layers === 5,
      })
    } catch (error) {
      const diagnostic = await readPasteboardDiagnostic(page, fixture.documentRef)
      throw new Error(`${error instanceof Error ? error.message : String(error)}；诊断：${JSON.stringify(diagnostic)}`)
    }
  }
  await editor.locator('[data-layer-id="ui-foreground-layer"] [data-layer-select]').click()
  await waitForEditorState(page, {
    message: '多图层移动工具没有就绪',
    read: () => editor.locator('[data-preview-surface]').getAttribute('data-move-availability'),
    accept: (availability) => availability === 'ready',
    timeout: 10000,
  })
  const previewSurface = editor.locator('[data-preview-surface]')
  await waitForEditorState(page, {
    message: '五层场景没有交给 GPU ImageBitmap 稳定呈现',
    read: async () => ({
      composition: await previewSurface.getAttribute('data-preview-composition-backend'),
      presentation: await previewSurface.getAttribute('data-preview-presentation-backend'),
      frameCount: Number(await editor.locator('[data-presentation-front-surface]')
        .getAttribute('data-gpu-frame-count') ?? '0'),
    }),
    accept: ({ composition, presentation, frameCount }) => composition === 'gpu'
      && presentation === 'gpu-image-bitmap'
      && frameCount > 0,
    timeout: 30000,
  })
  const previewBox = await previewSurface.boundingBox()
  if (!previewBox) throw new Error('多图层拖动前无法读取预览区域')
  const dragStartX = previewBox.x + previewBox.width / 2
  const dragStartY = previewBox.y + previewBox.height / 2
  const beforeLayerMove = Number(await commandBar.getAttribute('data-document-revision'))
  if (beforeLayerMove !== fixture.initialRevision) {
    throw new Error(`多图层拖动前 revision 异常：${beforeLayerMove}`)
  }
  const stableRaster = editor.locator('[data-raster-display-frame]')
  const gpuSurface = editor.locator('[data-presentation-front-surface]')
  const presentSamplesMs = []
  const driverSamplesMs = []
  const dragStartedAt = new Date().toISOString()
  const beforeHotPath = await page.evaluate(({ previewSelector, gpuSelector }) => {
    const preview = document.querySelector(previewSelector)
    const gpu = document.querySelector(gpuSelector)
    return {
      renderGeneration: Number(preview?.getAttribute('data-preview-render-generation') ?? '-1'),
      overrideCount: Number(preview?.getAttribute('data-preview-override-count') ?? '-1'),
      renderPlanCompileCount: Number(gpu?.getAttribute('data-render-plan-compile-count') ?? '-1'),
      cpuTaskStartCount: Number(gpu?.getAttribute('data-cpu-task-start-count') ?? '-1'),
      uploadCount: Number(gpu?.getAttribute('data-gpu-upload-count') ?? '-1'),
      readbackCount: Number(gpu?.getAttribute('data-gpu-readback-count') ?? '-1'),
      frameCount: Number(gpu?.getAttribute('data-gpu-frame-count') ?? '-1'),
      uniformUpdateCount: Number(gpu?.getAttribute('data-gpu-uniform-update-count') ?? '-1'),
      interactionSequence: Number(gpu?.getAttribute('data-interaction-sequence') ?? '-1'),
    }
  }, {
    previewSelector: '[data-preview-surface]',
    gpuSelector: '[data-presentation-front-surface]',
  })
  await page.keyboard.down('Control')
  await page.mouse.move(dragStartX, dragStartY)
  await page.mouse.down()
  for (let step = 1; step <= 100; step += 1) {
    const startedAt = performance.now()
    const previousSequence = Number(await gpuSurface.getAttribute('data-interaction-sequence') ?? '-1')
    await page.mouse.move(dragStartX + 1.5 * step, dragStartY + step)
    await page.waitForFunction(({ previous }) => Number(
      document.querySelector('[data-presentation-front-surface]')
        ?.getAttribute('data-interaction-sequence') ?? '-1'
    ) > previous, { previous: previousSequence }, { timeout: 5000 })
    driverSamplesMs.push(performance.now() - startedAt)
    const evidence = {
      revision: Number(await commandBar.getAttribute('data-document-revision')),
      overrideCount: Number(await previewSurface.getAttribute('data-preview-override-count')),
      renderGeneration: Number(await previewSurface.getAttribute('data-preview-render-generation')),
      stackVisibility: await rasterStack.count()
        ? await rasterStack.evaluate((element) => getComputedStyle(element).visibility)
        : 'absent',
      stableVisibility: await stableRaster.evaluate((element) => getComputedStyle(element).visibility),
      eventToPresentMs: Number(await gpuSurface.getAttribute('data-event-to-present-ms')),
      renderPlanCompileCount: Number(await gpuSurface.getAttribute('data-render-plan-compile-count')),
      cpuTaskStartCount: Number(await gpuSurface.getAttribute('data-cpu-task-start-count')),
      uploadCount: Number(await gpuSurface.getAttribute('data-gpu-upload-count')),
      readbackCount: Number(await gpuSurface.getAttribute('data-gpu-readback-count')),
      frameCount: Number(await gpuSurface.getAttribute('data-gpu-frame-count')),
      uniformUpdateCount: Number(await gpuSurface.getAttribute('data-gpu-uniform-update-count')),
    }
    if (evidence.revision !== beforeLayerMove
      || evidence.overrideCount !== 0
      || evidence.renderGeneration !== beforeHotPath.renderGeneration
      || (!fixture.complexGraph && evidence.stackVisibility !== 'hidden')
      || evidence.stableVisibility !== 'visible'
      || evidence.renderPlanCompileCount !== beforeHotPath.renderPlanCompileCount
      || evidence.cpuTaskStartCount !== beforeHotPath.cpuTaskStartCount
      || evidence.uploadCount !== beforeHotPath.uploadCount
      || evidence.readbackCount !== 0
      || !Number.isFinite(evidence.eventToPresentMs)
      || evidence.uniformUpdateCount > evidence.frameCount) {
      throw new Error(`GPU 移动热路径发生了权威/CPU/上传/回读副作用：${JSON.stringify({ beforeHotPath, evidence })}`)
    }
    presentSamplesMs.push(evidence.eventToPresentMs)
  }
  const afterHotPath = await page.evaluate((gpuSelector) => {
    const gpu = document.querySelector(gpuSelector)
    return {
      frameCount: Number(gpu?.getAttribute('data-gpu-frame-count') ?? '-1'),
      uniformUpdateCount: Number(gpu?.getAttribute('data-gpu-uniform-update-count') ?? '-1'),
      interactionSequence: Number(gpu?.getAttribute('data-interaction-sequence') ?? '-1'),
    }
  }, '[data-presentation-front-surface]')
  const presentedFrameDelta = afterHotPath.frameCount - beforeHotPath.frameCount
  const uniformUpdateDelta = afterHotPath.uniformUpdateCount - beforeHotPath.uniformUpdateCount
  const interactionSequenceDelta = afterHotPath.interactionSequence
    - beforeHotPath.interactionSequence
  if (presentSamplesMs.length !== 100
    || interactionSequenceDelta !== 100
    || presentedFrameDelta < presentSamplesMs.length
    || uniformUpdateDelta > presentedFrameDelta) {
    throw new Error(`GPU 移动采样没有逐事件推进实际呈现：${JSON.stringify({
      sampleCount: presentSamplesMs.length,
      interactionSequenceDelta,
      presentedFrameDelta,
      uniformUpdateDelta,
    })}`)
  }
  await page.mouse.up()
  await page.keyboard.up('Control')
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
    }),
    accept: (evidence) => (fixture.complexGraph || evidence.stackVisibility === 'hidden')
      && evidence.stableVisibility === 'visible',
  })
  await waitForEditorState(page, {
    message: 'GPU 移动松手后没有完成一次保存/一次 revision',
    read: () => page.evaluate(async ({ afterTimestamp, documentRef }) => {
      const result = await window.henjiNative.logging.queryLogEvents({
        date: new Date().toISOString().slice(0, 10),
        afterTimestamp,
        level: 'info',
        limit: 200,
      })
      const loaded = await window.henjiNative.imageEditorV3.loadDocument({
        requestId: `reality-multi-layer-post-drag-${crypto.randomUUID()}`,
        documentRef,
      })
      return {
        saveCount: result.events.filter((event) => (
          event.event === 'image_editor_v3.document.save.completed'
        )).length,
        persistedRevision: loaded?.revision ?? -1,
      }
    }, { afterTimestamp: dragStartedAt, documentRef: fixture.documentRef }),
    accept: (evidence) => evidence.saveCount === 1
      && evidence.persistedRevision === beforeLayerMove + 1,
    timeout: 12000,
  })
  const viewportSize = page.viewportSize() ?? { width: 1440, height: 900 }
  const baseline = viewportSize.width <= 960
    ? { p95Ms: 24.707, p99Ms: 31.821 }
    : { p95Ms: 23.947, p99Ms: 30.851 }
  const dragMetrics = {
    eventCount: 100,
    sampleCount: presentSamplesMs.length,
    interactionSequenceDelta,
    presentedFrameDelta,
    uniformUpdateDelta,
    p50Ms: percentile(presentSamplesMs, 0.5),
    p95Ms: percentile(presentSamplesMs, 0.95),
    p99Ms: percentile(presentSamplesMs, 0.99),
    driverP95Ms: percentile(driverSamplesMs, 0.95),
    driverP99Ms: percentile(driverSamplesMs, 0.99),
  }
  if (dragMetrics.p95Ms > Math.min(16.7, baseline.p95Ms / 3)
    || dragMetrics.p99Ms > Math.min(33.4, baseline.p99Ms / 3)) {
    throw new Error(`GPU 拖动性能未同时满足帧预算与 1.1 三倍提升：${JSON.stringify({ viewportSize, baseline, dragMetrics })}`)
  }

  return {
    dialog,
    editor,
    initialPreviewSource,
    result,
    dragBaseline: {
      ...dragMetrics,
      hotPath: {
        previewOverrideDelta: 0,
        revisionDelta: 0,
        renderPlanDelta: 0,
        cpuTaskDelta: 0,
        uploadDelta: 0,
        readbackDelta: 0,
      },
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
  selectOverlappingReactFlowNode,
  verifyHiddenBackgroundRasterStack,
  verifyMultiLayerDragPerformance,
}
