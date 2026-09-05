const sharp = require('sharp')
const {
  seedExistingMultiLayerIsolatedFixture,
} = require('./uiInspectionExistingMultiLayerFixture.cjs')

const PROJECT_ID_ENV = 'HENJI_REAL_MULTI_LAYER_PROJECT_ID'
const NODE_ID_ENV = 'HENJI_REAL_MULTI_LAYER_NODE_ID'
const EXPECTED_LAYER_COUNT_ENV = 'HENJI_REAL_MULTI_LAYER_EXPECTED_LAYER_COUNT'

function readExistingMultiLayerTarget(env) {
  const projectId = String(env[PROJECT_ID_ENV] ?? '').trim()
  const nodeId = String(env[NODE_ID_ENV] ?? '').trim()
  if (!projectId && !nodeId) return null
  if (!projectId || !nodeId) {
    throw new Error(`${PROJECT_ID_ENV} 与 ${NODE_ID_ENV} 必须同时设置`)
  }
  const expectedLayerCountValue = String(env[EXPECTED_LAYER_COUNT_ENV] ?? '').trim()
  const expectedLayerCount = expectedLayerCountValue ? Number(expectedLayerCountValue) : null
  if (expectedLayerCount !== null
    && (!Number.isInteger(expectedLayerCount) || expectedLayerCount < 2)) {
    throw new Error(`${EXPECTED_LAYER_COUNT_ENV} 必须是大于等于 2 的整数`)
  }
  return { projectId, nodeId, expectedLayerCount }
}

function createExistingMultiLayerReadOnlySceneDefinition(setup, env = process.env) {
  const target = readExistingMultiLayerTarget(env)
  if (!target) return null
  return {
    id: 'canvas-existing-multi-layer-readonly',
    surface: '画布',
    name: '画布-已有多图层文档只读打开',
    setup: (page, app, inspection) => setup(page, app, inspection, target),
  }
}

function escapeCssAttribute(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

async function fingerprintProjectRow(page, projectId) {
  return page.evaluate(async (targetProjectId) => {
    const rows = await window.henjiNative.db.select(
      `SELECT nodes_json, edges_json, viewport_json, history_json, updated_at
       FROM storyboard_projects WHERE id = ? LIMIT 1`,
      [targetProjectId]
    )
    const row = rows[0]
    if (!row) return null
    const result = {}
    for (const [field, value] of Object.entries(row)) {
      const encoded = new TextEncoder().encode(String(value ?? ''))
      const digest = await crypto.subtle.digest('SHA-256', encoded)
      result[field] = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    }
    return result
  }, projectId)
}

async function readTargetDocument(page, target) {
  return page.evaluate(async ({ projectId, nodeId }) => {
    const rows = await window.henjiNative.db.select(
      'SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1',
      [projectId]
    )
    const nodes = JSON.parse(rows[0]?.nodes_json ?? '[]')
    const node = nodes.find((candidate) => candidate.id === nodeId)
    const session = node?.data?.imageEditSession
    if (!session?.documentRef) {
      return { found: Boolean(node), editable: false }
    }
    const loaded = await window.henjiNative.imageEditorV3.loadDocument({
      requestId: `reality-existing-multi-layer-read-${crypto.randomUUID()}`,
      documentRef: session.documentRef,
    })
    return {
      found: true,
      editable: node?.type === 'layerStackResultNode' && session.kind === 'image-edit-v3',
      documentRef: session.documentRef,
      nodeRevision: session.revision,
      loadedRevision: loaded?.revision ?? null,
      layerCount: loaded?.document?.layers?.length ?? 0,
      visibleLayerCount: loaded?.document?.layers?.filter((layer) => layer.visible).length ?? 0,
    }
  }, target)
}

async function waitForGpuPresentation(page, editor) {
  const deadline = Date.now() + 90000
  let evidence = null
  while (Date.now() < deadline) {
    const preview = editor.locator('[data-preview-surface]')
    const front = editor.locator('[data-presentation-front-surface]')
    evidence = {
      composition: await preview.getAttribute('data-preview-composition-backend'),
      presentation: await preview.getAttribute('data-preview-presentation-backend'),
      device: await preview.getAttribute('data-preview-device-status'),
      coverage: Number(await preview.getAttribute('data-preview-coverage') ?? '0'),
      frameCount: Number(await front.getAttribute('data-gpu-frame-count') ?? '0'),
      surfaceFrameCount: Number(await front.getAttribute('data-gpu-surface-frame-count') ?? '0'),
      imageBitmapFrameCount: Number(
        await front.getAttribute('data-gpu-image-bitmap-frame-count') ?? '-1'
      ),
      directSurfaceFailureCount: Number(
        await front.getAttribute('data-gpu-direct-surface-failure-count') ?? '-1'
      ),
    }
    if (evidence.composition === 'gpu'
      && evidence.presentation === 'webgpu-surface'
      && evidence.device === 'ready'
      && evidence.coverage > 0
      && evidence.frameCount > 0
      && evidence.surfaceFrameCount > 0
      && evidence.imageBitmapFrameCount === 0
      && evidence.directSurfaceFailureCount === 0) return evidence
    await page.waitForTimeout(100)
  }
  throw new Error(`已有多图层文档 GPU 呈现未就绪：${JSON.stringify(evidence)}`)
}

async function waitForCpuPresentation(page, editor) {
  const preview = editor.locator('[data-preview-surface]')
  const gpuSurface = editor.locator('[data-presentation-gpu-surface]')
  const deadline = Date.now() + 90000
  let evidence = null
  while (Date.now() < deadline) {
    evidence = {
      composition: await preview.getAttribute('data-preview-composition-backend'),
      presentation: await preview.getAttribute('data-preview-presentation-backend'),
      device: await preview.getAttribute('data-preview-device-status'),
      coverage: Number(await preview.getAttribute('data-preview-coverage') ?? '0'),
      gpuVisibility: await gpuSurface.evaluate((element) => getComputedStyle(element).visibility),
    }
    if (evidence.composition === 'cpu'
      && evidence.presentation === 'canvas2d'
      && evidence.coverage > 0
      && evidence.gpuVisibility === 'hidden') return evidence
    await page.waitForTimeout(100)
  }
  throw new Error(`已有多图层文档 CPU 回退呈现未就绪：${JSON.stringify(evidence)}`)
}

async function waitForInjectedGpuFailure(page, afterTimestamp) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const evidence = await page.evaluate(async (startedAt) => {
      const result = await window.henjiNative.logging.queryLogEvents({
        date: new Date().toISOString().slice(0, 10),
        afterTimestamp: startedAt,
        domainPrefix: 'features.image_edit.v3.gpu_scene',
        limit: 100,
      })
      const failure = result.events.find(
        (event) => event.event === 'image_editor_v3.gpu_scene.failed'
      )
      if (!failure) return null
      return {
        code: failure.context?.code,
        recoverable: failure.context?.recoverable,
        deviceAcquireCount: Number(failure.context?.diagnosticDeviceAcquireCount ?? -1),
        surfaceFrameCount: Number(failure.context?.diagnosticSurfaceFrameCount ?? -1),
      }
    }, afterTimestamp)
    if (evidence) {
      if (evidence.code !== 'initialization-failed'
        || evidence.recoverable !== true
        || evidence.deviceAcquireCount !== 0
        || evidence.surfaceFrameCount !== 0) {
        throw new Error(`GPU 初始化失败注入证据不符合契约：${JSON.stringify(evidence)}`)
      }
      return evidence
    }
    await page.waitForTimeout(100)
  }
  throw new Error('没有观察到 GPU 初始化失败注入证据')
}

async function assertPresentationIsNotBlack(page, editor) {
  const documentBox = await editor.locator('[data-document-transparency-grid]').boundingBox()
  if (!documentBox || documentBox.width < 1 || documentBox.height < 1) {
    throw new Error('已有多图层文档没有可采样的呈现区域')
  }
  const screenshot = await page.screenshot({
    animations: 'disabled',
    clip: documentBox,
  })
  const { data, info } = await sharp(screenshot)
    .removeAlpha()
    .resize(64, 64, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  let nonBlack = 0
  let chromatic = 0
  let redDominant = 0
  let maximumChannel = 0
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    maximumChannel = Math.max(maximumChannel, maximum)
    if (maximum > 16) nonBlack += 1
    if (maximum - minimum > 28) chromatic += 1
    if (red - green > 30 && red - blue > 20) redDominant += 1
  }
  const pixelCount = info.width * info.height
  const ratios = {
    nonBlackRatio: nonBlack / pixelCount,
    chromaticRatio: chromatic / pixelCount,
    redDominantRatio: redDominant / pixelCount,
  }
  if (maximumChannel <= 24
    || ratios.nonBlackRatio < 0.01
    || ratios.chromaticRatio < 0.01
    || ratios.redDominantRatio < 0.002) {
    throw new Error(`已有多图层文档没有呈现预期彩色图像：${JSON.stringify({
      maximumChannel,
      ...ratios,
    })}`)
  }
  return Object.fromEntries(Object.entries({ maximumChannel, ...ratios }).map(([key, value]) => (
    [key, typeof value === 'number' ? Number(value.toFixed(4)) : value]
  )))
}

async function openTargetEditor(page, target) {
  const node = page.locator(
    `[data-layer-stack-node-id="${escapeCssAttribute(target.nodeId)}"]`
  )
  if (await node.count() === 0 || !await node.first().isVisible()) {
    const project = page.locator(
      `[data-project-id="${escapeCssAttribute(target.projectId)}"]:visible`
    )
    await project.waitFor({ state: 'visible', timeout: 15000 })
    await project.click()
  }
  await node.waitFor({ state: 'visible', timeout: 15000 })
  await node.evaluate((element) => element.click())
  const edit = node.getByRole('button', { name: /^(编辑|Edit)$/i })
  await edit.waitFor({ state: 'attached', timeout: 8000 })
  await edit.evaluate((element) => element.click())
  const dialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
  await dialog.waitFor({ state: 'visible', timeout: 30000 })
  const editor = dialog.locator('[data-image-editor-v3]')
  await editor.waitFor({ state: 'visible', timeout: 15000 })
  return { dialog, editor, node }
}

function attachUiInspectionCanvasExistingMultiLayer(context) {
  const { settlePage, setupCanvas } = context

  async function runExistingMultiLayerReadOnly(
    page,
    inspection,
    target,
    expectedBackend,
    preserveProjectContent = true,
    reopen = true,
  ) {
    const startedAt = new Date().toISOString()
    const beforeFingerprint = await fingerprintProjectRow(page, target.projectId)
    const initial = await readTargetDocument(page, target)
    if (!beforeFingerprint || !initial.found || !initial.editable
      || initial.nodeRevision !== initial.loadedRevision
      || initial.layerCount < 2
      || (target.expectedLayerCount !== null
        && initial.layerCount !== target.expectedLayerCount)) {
      throw new Error(`已有多图层只读目标不符合 V3 文档契约：${JSON.stringify({
        projectFound: Boolean(beforeFingerprint),
        nodeFound: initial.found,
        editable: initial.editable,
        revisionAligned: initial.nodeRevision === initial.loadedRevision,
        layerCount: initial.layerCount,
        expectedLayerCount: target.expectedLayerCount,
        visibleLayerCount: initial.visibleLayerCount,
      })}`)
    }

    await setupCanvas(page)
    const targetNode = page.locator(
      `[data-layer-stack-node-id="${escapeCssAttribute(target.nodeId)}"]:visible`
    )
    if (!(await targetNode.count()) && await page.locator('.react-flow:visible').count()) {
      await page.getByRole('button', { name: /返回项目|Back to Projects/i }).click()
      await settlePage(page, 350)
    }

    const first = await openTargetEditor(page, target)
    const firstPresentation = expectedBackend === 'gpu'
      ? await waitForGpuPresentation(page, first.editor)
      : await waitForCpuPresentation(page, first.editor)
    const injectedFailure = expectedBackend === 'cpu'
      ? await waitForInjectedGpuFailure(page, startedAt)
      : null
    const firstPixels = await assertPresentationIsNotBlack(page, first.editor)
    await settlePage(page, 350)
    await inspection?.capture?.('first-open')
    if (!reopen) {
      const afterOpen = await readTargetDocument(page, target)
      const afterOpenFingerprint = await fingerprintProjectRow(page, target.projectId)
      const changedContentFields = Object.keys(beforeFingerprint).filter((field) => (
        ['nodes_json', 'edges_json', 'history_json'].includes(field)
        && beforeFingerprint[field] !== afterOpenFingerprint?.[field]
      ))
      if (afterOpen.loadedRevision !== initial.loadedRevision || changedContentFields.length > 0) {
        throw new Error(`已有多图层只读打开修改了文档或工程内容：${JSON.stringify({
          revisionUnchanged: afterOpen.loadedRevision === initial.loadedRevision,
          changedContentFields,
        })}`)
      }
      process.stdout.write(`  已有多图层文档只读 GPU 打开：${JSON.stringify({
        layerCount: initial.layerCount,
        presentation: firstPresentation,
        pixels: firstPixels,
        revisionUnchanged: true,
        projectContentUnchanged: true,
      })}\n`)
      return
    }
    await first.dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await first.dialog.waitFor({ state: 'hidden', timeout: 60000 })
    const afterFirstClose = await readTargetDocument(page, target)
    if (afterFirstClose.loadedRevision !== initial.loadedRevision) {
      throw new Error('已有多图层文档首次只读关闭后 revision 发生变化')
    }

    const second = await openTargetEditor(page, target)
    const secondPresentation = expectedBackend === 'gpu'
      ? await waitForGpuPresentation(page, second.editor)
      : await waitForCpuPresentation(page, second.editor)
    const secondPixels = await assertPresentationIsNotBlack(page, second.editor)
    await settlePage(page, 350)
    await inspection?.capture?.('second-open')
    await second.dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await second.dialog.waitFor({ state: 'hidden', timeout: 60000 })

    const final = await readTargetDocument(page, target)
    const afterFingerprint = await fingerprintProjectRow(page, target.projectId)
    const changedProjectFields = Object.keys(beforeFingerprint).filter(
      (field) => beforeFingerprint[field] !== afterFingerprint?.[field]
    )
    const changedContentFields = changedProjectFields.filter(
      (field) => ['nodes_json', 'edges_json', 'history_json'].includes(field)
    )
    if (final.loadedRevision !== initial.loadedRevision
      || (preserveProjectContent && changedContentFields.length > 0)) {
      throw new Error(`已有多图层只读场景修改了原文档或工程内容：${JSON.stringify({
        revisionUnchanged: final.loadedRevision === initial.loadedRevision,
        changedContentFields,
      })}`)
    }
    process.stdout.write(`  已有多图层文档只读${expectedBackend === 'gpu' ? ' GPU 呈现' : ' CPU 回退'}：${JSON.stringify({
      layerCount: initial.layerCount,
      firstPresentation,
      secondPresentation,
      firstPixels,
      secondPixels,
      ...(injectedFailure ? { injectedFailure } : {}),
      revisionUnchanged: true,
      projectContentUnchanged: changedContentFields.length === 0,
      isolatedProject: !preserveProjectContent,
      changedContentFields,
      navigationFieldsChanged: changedProjectFields.filter(
        (field) => !changedContentFields.includes(field)
      ),
    })}\n`)
  }

  async function setupCanvasExistingMultiLayerReadOnly(page, _app, inspection, target) {
    await runExistingMultiLayerReadOnly(page, inspection, target, 'gpu', true, false)
  }

  async function setupCanvasExistingMultiLayerIsolatedCpuFallback(page, _app, inspection, source) {
    const target = await seedExistingMultiLayerIsolatedFixture(page, context, source)
    await runExistingMultiLayerReadOnly(page, inspection, target, 'cpu', false)
  }

  Object.assign(context, {
    setupCanvasExistingMultiLayerReadOnly,
    setupCanvasExistingMultiLayerIsolatedCpuFallback,
  })
}

module.exports = {
  attachUiInspectionCanvasExistingMultiLayer,
  createExistingMultiLayerReadOnlySceneDefinition,
  readExistingMultiLayerTarget,
}
