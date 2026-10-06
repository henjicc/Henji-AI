const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')

/*
 * 3.4 画布接入文档底座的真实 Electron 验收，跑在 mcp-restart-check 的同一套隔离资料目录与两次完整启动上
 * （--only canvas-documents）：
 *
 * 第一次启动（石墨）：画布页 → 新建画布（草稿直接写进作品目录“画布/”）→ 右键加上传节点并选图 →
 *   离开时“取消 / 保存（起名）”、另一份“不保存”、空草稿直接删除 → 在已保存的画布里点“生成”（生成通道换成
 *   本地替身，零供应商请求；核对请求带上了画布所在容器）→ 拖动节点（留一步撤销）、改视口 → 返回列表；
 *   另造一份带多图层节点的画布，在多图层编辑器里改图层不透明度 → 返回列表（关闭时写出内嵌包）。
 * 第二次启动（纸白）：列表还在；打开“画布一号”：视口恢复、Ctrl+Z 撤回上次拖动；多图层画布移进新项目
 *   （内嵌包随画布复制）、创建副本（打开时分出自己的图层文档）、整个项目文件夹拷到别处后打开（同样分出），
 *   三处图层都在、不透明度是改过的值。
 *
 * 画布数据经界面与正式文档接口（测试夹具）造，不写 SQL；回收站换成记录替身，不往真实回收站放测试文件。
 */

const WINDOW_SIZE = { width: 1440, height: 900 }
const REFERENCE_IMAGE = path.resolve('resources/icons/icon.png')
const IMAGE_MODEL = 'kie-z-image'

async function limited(operation, milliseconds, label) {
  let timer
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${milliseconds}ms）`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}

async function capture(instance, file, result) {
  const bytes = await limited(() => captureInspectionPage(instance.app, instance.page, {
    onEvidence: (value) => { result.captures = [...(result.captures ?? []), { file, ...value }] },
  }), 10000, 'Electron 原生截图')
  fs.writeFileSync(file, bytes)
}

async function finishRuntime(collector, instance, startedAt) {
  const runtime = await limited(() => collector.finish(), 10000, '正式应用日志查询')
  const startup = await limited(() => queryApplicationLogs(instance.page, {
    afterTimestamp: startedAt, endTimestamp: runtime.finishedAt, level: 'error',
  }), 10000, '完整启动日志查询')
  runtime.startupLogErrors = startup.events
  runtime.passed = runtime.passed && !startup.events.length && !startup.truncated && !startup.corruptedLines
  return runtime
}

/** 主进程里把回收站换成记录替身、把生成通道换成本地替身（只影响这个隔离实例）。 */
async function stubMain(app, { recycleDir, resultImage }) {
  await app.evaluate(({ shell, ipcMain }, { recycle, image }) => {
    const nodeFs = process.mainModule.require('node:fs')
    const nodePath = process.mainModule.require('node:path')
    globalThis.__henjiRealityShell = { trashed: [], revealed: [] }
    shell.trashItem = async (target) => {
      nodeFs.mkdirSync(recycle, { recursive: true })
      nodeFs.renameSync(target, nodePath.join(recycle, `${Date.now()}-${nodePath.basename(target)}`))
      globalThis.__henjiRealityShell.trashed.push(target)
    }
    shell.showItemInFolder = (target) => { globalThis.__henjiRealityShell.revealed.push(target) }
    globalThis.__canvasGenerationRequests = []
    ipcMain.removeHandler('ai:generate')
    ipcMain.handle('ai:generate', async (_event, request) => {
      globalThis.__canvasGenerationRequests.push(JSON.parse(JSON.stringify(request)))
      return { ok: true, data: { status: 'completed', url: image, filePath: image } }
    })
  }, { recycle: recycleDir, image: resultImage })
}

async function waitUntil(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const readShell = (app) => app.evaluate(() => globalThis.__henjiRealityShell)
const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
const card = (page, id) => page.locator(`[data-project-id="${id}"]:visible`).first()
const readCanvas = (page, id) => page.evaluate((docId) => window.henjiNative.testFixtures.readCanvas(docId), id)

async function listCanvases(page) {
  return await page.evaluate(() => window.henjiNative.documents.listDocuments({
    kind: 'canvas', container: { kind: 'any' }, includeDrafts: true, includeMissing: true,
  }))
}

async function documentNamed(page, name) {
  const found = (await listCanvases(page)).find((document) => document.name === name)
  assert.ok(found, `作品索引里找不到画布“${name}”`)
  return found
}

async function openCanvasList(page) {
  await page.getByRole('button', { name: /^(画布|Canvas)$/ }).filter({ visible: true }).first().click()
  const back = page.getByRole('button', { name: '返回画布列表', exact: true }).filter({ visible: true })
  if (await back.count()) {
    await back.first().click()
    const prompt = page.getByRole('alertdialog')
    if (await prompt.isVisible().catch(() => false)) throw new Error('打开画布列表时遇到未处理的离开提示')
  }
  await button(page, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(500)
}

async function openCanvas(page, id) {
  await card(page, id).waitFor({ state: 'visible', timeout: 15000 })
  await card(page, id).click()
  await page.locator('.react-flow').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(800)
}

async function clickBack(page) {
  await button(page, '返回画布列表').click()
}

async function leavePrompt(page) {
  const prompt = page.getByRole('alertdialog')
  await prompt.waitFor({ state: 'visible', timeout: 8000 })
  return prompt
}

async function contextMenuAction(page, id, label) {
  await card(page, id).waitFor({ state: 'visible', timeout: 15000 })
  await card(page, id).click({ button: 'right' })
  const menu = page.getByRole('menu')
  await menu.waitFor({ state: 'visible', timeout: 5000 })
  await menu.getByText(label, { exact: true }).click()
}

/** 右键画布空白处加一个上传节点并选图（与用户一致：走正式上传链路）。返回节点 ID。 */
async function addUploadNode(page, position) {
  const viewport = page.locator('[data-application-observation-region="canvas.viewport_observer"]:visible')
  await viewport.waitFor({ state: 'visible', timeout: 12000 })
  const before = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')))
  await viewport.click({ button: 'right', position })
  const addMenu = page.getByRole('menu', { name: /^(添加节点|Add Node)$/i })
  await addMenu.waitFor({ state: 'visible', timeout: 8000 })
  await addMenu.getByRole('menuitem', { name: /^(上传|Upload)$/i }).click()
  const source = page.locator('.react-flow__node:has(input[type="file"])').last()
  await source.waitFor({ state: 'visible', timeout: 8000 })
  await source.locator('input[type="file"]').setInputFiles(REFERENCE_IMAGE)
  await source.locator('img').first().waitFor({ state: 'visible', timeout: 12000 })
  await page.waitForTimeout(500)
  const after = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-id')))
  const added = after.filter((id) => !before.includes(id))
  assert.equal(added.length, 1, `应只新增一个上传节点：${JSON.stringify(added)}`)
  return added[0]
}

function nodeTranslate(page, id) {
  return page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return { x: Math.round(matrix.m41), y: Math.round(matrix.m42) }
  })
}

function viewportTransform(page) {
  return page.locator('.react-flow__viewport').first().evaluate((element) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
    return { x: Math.round(matrix.m41), y: Math.round(matrix.m42), zoom: Number(matrix.a.toFixed(3)) }
  })
}

/** 造一份 V3 两层图片文档与带多图层节点的画布（经正式图片编辑接口与测试夹具）。 */
async function seedMultiLayerCanvas(page, name) {
  return await page.evaluate(async (canvasName) => {
    const draw = async (fill, overlay) => {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 200
      const context = canvas.getContext('2d')
      context.fillStyle = fill
      context.fillRect(0, 0, 320, 200)
      if (overlay) {
        context.clearRect(0, 0, 320, 200)
        context.fillStyle = overlay
        context.fillRect(60, 40, 160, 120)
      }
      return canvas.toDataURL('image/png')
    }
    const ingest = async (dataUrl, label) => await window.henjiNative.imageEditorV3.ingestSource({
      requestId: `reality-canvas-layers-${label}-${crypto.randomUUID()}`,
      source: { kind: 'data-url', dataUrl },
    })
    const base = await ingest(await draw('rgb(14, 116, 144)', null), 'base')
    const top = await ingest(await draw('rgb(0, 0, 0)', 'rgb(244, 63, 94)'), 'top')
    const documentId = `reality-canvas-layers-${crypto.randomUUID()}`
    const layer = (id, layerName, resource) => ({
      id, name: layerName, type: 'raster', visible: true, locked: false, opacity: 1, blendMode: 'normal',
      transform: [1, 0, 0, 1, 0, 0], mask: null, source: { kind: 'resource', resourceId: resource }, tiles: {},
    })
    const saved = await window.henjiNative.imageEditorV3.saveDocument({
      requestId: `reality-canvas-layers-save-${crypto.randomUUID()}`,
      document: {
        version: 3, id: documentId, revision: 0,
        geometry: { width: 320, height: 200, orientation: { rotate: 0, mirrored: false }, crop: null },
        color: { workingSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb', hdrMetadata: null, iccProfileResourceId: null },
        layers: [layer('reality-layer-base', '底图', base.resource.resourceRef), layer('reality-layer-top', '前景', top.resource.resourceRef)],
      },
      expectedRevision: 0, history: null,
      resourceRefs: [base.resource.resourceRef, top.resource.resourceRef], previewRef: null,
    })
    const nodeId = 'reality-layer-stack'
    const created = await window.henjiNative.testFixtures.createCanvas({
      name: canvasName,
      viewport: { x: 80, y: 120, zoom: 0.8 },
      nodes: [{
        id: nodeId, type: 'layerStackResultNode', position: { x: 120, y: 80 },
        width: 480, height: 300, measured: { width: 480, height: 300 }, style: { width: 480, height: 300 },
        data: {
          displayName: '多图层', imageUrl: base.mediaUrl, previewImageUrl: base.mediaUrl, aspectRatio: '320:200',
          resultKind: 'layer-stack', isGenerating: false,
          imageEditSession: { kind: 'image-edit-v3', sourceUrl: base.mediaUrl, documentRef: saved.documentRef, revision: saved.revision, previewRef: saved.previewRef },
        },
      }],
    })
    return { canvasId: created.id, nodeId, documentRef: saved.documentRef }
  }, name)
}

async function loadLayers(page, documentRef) {
  return await page.evaluate(async (ref) => {
    const loaded = await window.henjiNative.imageEditorV3.loadDocument({ requestId: `reality-canvas-layers-load-${crypto.randomUUID()}`, documentRef: ref })
    return { revision: loaded.revision, layers: loaded.document.layers.map((layer) => ({ id: layer.id, opacity: layer.opacity })) }
  }, documentRef)
}

async function nodeDocumentRef(page, canvasId, nodeId) {
  const canvas = await readCanvas(page, canvasId)
  return canvas?.nodes.find((node) => node.id === nodeId)?.data?.imageEditSession?.documentRef ?? null
}

/** 打开画布、等多图层节点就绪；返回节点当前引用的图片文档。 */
async function openLayerCanvas(page, canvasId, nodeId) {
  await openCanvas(page, canvasId)
  await page.locator(`[data-layer-stack-node-id="${nodeId}"][data-layer-stack-status="editable-v3"]`).waitFor({ state: 'visible', timeout: 20000 })
  await waitUntil(async () => Boolean(await nodeDocumentRef(page, canvasId, nodeId)), '多图层节点引用可读')
  return await nodeDocumentRef(page, canvasId, nodeId)
}

function readEnvelope(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 复用 mcp-restart-check 的启动器与隔离资料目录，不另建 Electron 启动链。 */
async function runCanvasDocumentsRestart({ launch, userDataDir, outDir }) {
  const evidenceFile = path.join(outDir, 'canvas-documents-restart.json')
  const documentsRoot = path.join(userDataDir, 'app-data', 'Documents')
  const recycleDir = path.join(userDataDir, 'recycle')
  const resultImage = path.join(userDataDir, 'generation-fixture', '生成替身.png')
  fs.mkdirSync(path.dirname(resultImage), { recursive: true })
  fs.copyFileSync(REFERENCE_IMAGE, resultImage)
  const evidence = { target: 'canvas-documents', userDataDir, documentsRoot, passed: false, firstRun: {}, secondRun: {} }
  const save = () => fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2))
  let current = null
  let collector = null
  let currentRun = evidence.firstRun
  const closeCurrent = async () => {
    if (!current) return
    const child = current.app.process()
    await limited(() => current.close(), 25000, '完整 Electron 退出')
    currentRun.exit = { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode }
    current = null
  }
  const start = async (extraArgs) => {
    currentRun.startedAt = new Date().toISOString()
    current = await launch(userDataDir, { extraArgs })
    current.page.setDefaultTimeout(10000)
    currentRun.pid = current.app.process().pid
    currentRun.window = await setInspectionWindowSize(current, WINDOW_SIZE)
    await stubMain(current.app, { recycleDir, resultImage })
    // 记下所有失败的资源请求地址（控制台只报“404”，不带地址），失败时便于定位
    const run = currentRun
    current.page.on('response', (response) => {
      if (response.status() >= 400) run.failedResources = [...(run.failedResources ?? []), { status: response.status(), url: response.url().slice(0, 300) }]
    })
    current.page.on('requestfailed', (request) => {
      run.failedResources = [...(run.failedResources ?? []), { failure: request.failure()?.errorText ?? 'failed', url: request.url().slice(0, 300) }]
    })
    collector = createRuntimeEvidenceCollector(current.page)
  }
  const shot = async (name) => capture(current, path.join(outDir, `canvas-documents-${name}.png`), currentRun)

  try {
    // ==================== 第一次启动：石墨 ====================
    await start(['--dev-theme-preset=graphite'])
    collector.begin('canvas-documents-first')
    const { page } = current
    await page.evaluate(() => window.henjiNative.ai.setProviderApiKey('kie', 'isolated-canvas-documents-fixture'))
    const workRoot = path.join(documentsRoot, '痕迹AI')
    const canvasFolder = path.join(workRoot, '画布')
    await openCanvasList(page)

    // —— 有内容的草稿：取消留在画布，再保存起名 ——
    await button(page, '新建画布').click()
    await page.locator('.react-flow').waitFor({ state: 'visible', timeout: 15000 })
    const draftOne = (await listCanvases(page)).find((document) => document.draft)
    assert.ok(draftOne && path.dirname(draftOne.path) === canvasFolder, `新建的画布应以草稿标记直接写进“画布/”：${JSON.stringify(draftOne)}`)
    const uploadId = await addUploadNode(page, { x: 260, y: 240 })
    await clickBack(page)
    let prompt = await leavePrompt(page)
    await prompt.getByRole('button', { name: '取消', exact: true }).click()
    await page.locator(`.react-flow__node[data-id="${uploadId}"]`).waitFor({ state: 'visible', timeout: 5000 })
    await clickBack(page)
    prompt = await leavePrompt(page)
    await shot('graphite-leave-prompt')
    await prompt.getByRole('button', { name: '保存', exact: true }).click()
    const nameDialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last()
    const nameInput = nameDialog.getByRole('textbox').first()
    await nameInput.waitFor({ state: 'visible', timeout: 8000 })
    await nameInput.fill('画布一号')
    await page.waitForTimeout(500)
    await nameDialog.getByRole('button', { name: '保存', exact: true }).click()
    await button(page, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    const saved = await documentNamed(page, '画布一号')
    assert.equal(saved.draft, false, '保存后必须去掉草稿标记')
    assert.equal(saved.id, draftOne.id, '草稿转正不换 ID')
    assert.equal(saved.path, path.join(canvasFolder, '画布一号.henji-canvas'))
    const envelope = readEnvelope(saved.path)
    assert.equal(envelope.kind, 'canvas')
    assert.equal(envelope.content.nodes.length, 1, '保存的画布应有上传节点')
    assert.equal(Object.keys(envelope.content).includes('viewport'), false, '视口不写进画布文档')
    assert.equal(JSON.stringify(envelope).includes(userDataDir.replace(/\\/g, '\\\\')), false, '画布文档里不得出现隔离资料目录的绝对路径')
    currentRun.saved = { id: saved.id, path: saved.path, uploadedImage: envelope.content.nodes[0].data.imageUrl }

    // —— 不保存：移到回收站 ——
    await button(page, '新建画布').click()
    await page.locator('.react-flow').waitFor({ state: 'visible', timeout: 15000 })
    const draftTwo = (await listCanvases(page)).find((document) => document.draft)
    await addUploadNode(page, { x: 320, y: 260 })
    await clickBack(page)
    prompt = await leavePrompt(page)
    await prompt.getByRole('button', { name: '不保存', exact: true }).click()
    await button(page, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(fs.existsSync(draftTwo.path), false, '“不保存”后草稿文件应移到回收站')
    assert.ok((await readShell(current.app)).trashed.includes(draftTwo.path), '“不保存”必须走系统回收站')

    // —— 空草稿：不询问，直接删除 ——
    const trashedBefore = (await readShell(current.app)).trashed.length
    await button(page, '新建画布').click()
    await page.locator('.react-flow').waitFor({ state: 'visible', timeout: 15000 })
    const draftThree = (await listCanvases(page)).find((document) => document.draft)
    await clickBack(page)
    await button(page, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByRole('alertdialog').count(), 0, '空草稿离开时不应询问')
    assert.equal(fs.existsSync(draftThree.path), false, '空草稿离开时应直接删除')
    assert.equal((await readShell(current.app)).trashed.length, trashedBefore, '空草稿直接删除，不进回收站')
    currentRun.drafts = { cancelledThenSaved: draftOne.id, discarded: draftTwo.path, emptyDeleted: draftThree.path }

    // —— 在已保存的画布里生成（本地替身）：请求带上画布所在容器 ——
    await page.evaluate(async ({ id, model }) => {
      const canvas = await window.henjiNative.testFixtures.readCanvas(id)
      await window.henjiNative.testFixtures.writeCanvas(id, { nodes: [...canvas.nodes, {
        id: 'reality-image-generator', type: 'imageNode', position: { x: 620, y: 120 },
        data: { displayName: '图片生成', prompt: '画布接入验收：本地替身生成', modelId: model, params: {}, mediaInputs: {},
          aspectRatio: '1:1', imageUrl: null, previewImageUrl: null, isGenerating: false, generationStartedAt: null },
      }] })
    }, { id: saved.id, model: IMAGE_MODEL })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openCanvasList(page)
    await openCanvas(page, saved.id)
    const generator = page.locator('.react-flow__node[data-id="reality-image-generator"]')
    await generator.click({ position: { x: 3, y: 3 } })
    await page.locator('.react-flow__node[data-id="reality-image-generator"].selected').waitFor()
    await page.locator('.react-flow__node-toolbar[data-id="reality-image-generator"]').getByRole('button', { name: '生成', exact: true }).click()
    await waitUntil(async () => (await current.app.evaluate(() => globalThis.__canvasGenerationRequests.length)) > 0, '画布发出生成请求', 15000)
    const generationRequest = (await current.app.evaluate(() => globalThis.__canvasGenerationRequests))[0]
    assert.deepEqual(generationRequest.outputContainer, { kind: 'user' }, `独立画布的生成结果应放进作品目录：${JSON.stringify(generationRequest.outputContainer)}`)
    await waitUntil(async () => {
      const canvas = await readCanvas(page, saved.id)
      return canvas.nodes.some((node) => node.data?.generationSourceNodeId === 'reality-image-generator' && node.data?.imageUrl && !node.data?.isGenerating)
    }, '生成结果写回画布', 20000)
    currentRun.generation = { modelId: generationRequest.modelId, outputContainer: generationRequest.outputContainer }

    // —— 留一步撤销（拖动上传节点）并改视口 ——
    const header = page.locator(`[data-node-header-drag-surface="${uploadId}"]`)
    const beforeDrag = await nodeTranslate(page, uploadId)
    const box = await header.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 160, box.y + box.height / 2 + 90, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(300)
    const afterDrag = await nodeTranslate(page, uploadId)
    assert.notDeepEqual(afterDrag, beforeDrag, '拖动应移动节点')
    const pane = page.locator('.react-flow__pane').first()
    const paneBox = await pane.boundingBox()
    // 在画布左侧空白处滚动（右下角是小地图，不在这里滚）
    await page.mouse.move(paneBox.x + 160, paneBox.y + paneBox.height / 2)
    await page.mouse.wheel(0, -240)
    await page.waitForTimeout(600)
    const viewportBefore = await viewportTransform(page)
    await shot('graphite-canvas')
    await clickBack(page)
    await button(page, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    await waitUntil(async () => {
      const node = (await readCanvas(page, saved.id)).nodes.find((item) => item.id === uploadId)
      return Boolean(node) && Math.round(node.position.x) !== Math.round(envelope.content.nodes[0].position.x)
    }, '拖动后的位置写进画布文件')
    currentRun.undoProbe = { uploadId, beforeDrag, afterDrag }
    currentRun.viewport = viewportBefore
    const storedState = await readCanvas(page, saved.id)
    currentRun.storedSessionState = { viewport: storedState.viewport, historyRevision: storedState.history?.revision ?? null, revision: storedState.revision }

    // —— 多图层画布：在编辑器里改不透明度，返回列表时写出内嵌包 ——
    const layered = await seedMultiLayerCanvas(page, '多图层画布')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await openCanvasList(page)
    await openLayerCanvas(page, layered.canvasId, layered.nodeId)
    await page.locator(`[data-layer-stack-node-id="${layered.nodeId}"]`).dblclick()
    const editorDialog = page.getByRole('dialog', { name: /多图层图片编辑器|Multi-layer image editor/i })
    await editorDialog.waitFor({ state: 'visible', timeout: 15000 })
    await editorDialog.locator('[data-image-editor-v3]').waitFor({ state: 'visible', timeout: 60000 })
    await page.waitForTimeout(1000)
    const tab = editorDialog.getByRole('tab', { name: '基础', exact: true }).filter({ visible: true }).first()
    if (await tab.count()) await tab.click()
    const slider = editorDialog.getByRole('slider', { name: '不透明度' }).filter({ visible: true }).first()
    await slider.waitFor({ state: 'visible', timeout: 10000 })
    await slider.focus()
    for (let index = 0; index < 4; index += 1) await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(600)
    await editorDialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
    await editorDialog.waitFor({ state: 'hidden', timeout: 60000 })
    let edited = null
    await waitUntil(async () => {
      edited = await loadLayers(page, layered.documentRef)
      return edited.revision > 0 && edited.layers.some((layer) => layer.opacity < 1)
    }, '图层不透明度写进图片文档', 20000)
    await waitUntil(async () => {
      const node = (await readCanvas(page, layered.canvasId)).nodes.find((item) => item.id === layered.nodeId)
      return node?.data?.imageEditSession?.revision === edited.revision
    }, '画布节点跟上图片文档版本', 20000)
    await clickBack(page)
    await button(page, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    const layeredDocument = await documentNamed(page, '多图层画布')
    const documentId = layered.documentRef.slice('image-edit-v3:'.length)
    const packagePath = path.join(workRoot, '.henji', 'canvas-layers', `${documentId}.henjilayer`)
    await waitUntil(async () => fs.existsSync(packagePath), '关闭画布时写出内嵌图片文档包', 20000)
    const layeredEnvelope = readEnvelope(layeredDocument.path)
    assert.equal(layeredEnvelope.content.layerPackages?.[documentId], `henji:/.henji/canvas-layers/${documentId}.henjilayer`,
      `画布内容应以相对写法记下内嵌包：${JSON.stringify(layeredEnvelope.content.layerPackages)}`)
    currentRun.layers = { canvasId: layered.canvasId, documentRef: layered.documentRef, edited, packagePath }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()

    // ==================== 第二次启动：纸白 ====================
    currentRun = evidence.secondRun
    await start(['--dev-theme-preset=paper'])
    collector.begin('canvas-documents-second')
    const second = current.page
    assert.notEqual(currentRun.pid, evidence.firstRun.pid, '必须是新的 Electron 主进程')
    await openCanvasList(second)
    await card(second, saved.id).waitFor({ state: 'visible', timeout: 15000 })
    await card(second, layered.canvasId).waitFor({ state: 'visible', timeout: 15000 })
    await shot('paper-list-after-restart')

    // —— 画布一号：视口与撤销恢复 ——
    const storedAfterRestart = await readCanvas(second, saved.id)
    currentRun.storedSessionState = { viewport: storedAfterRestart.viewport, historyRevision: storedAfterRestart.history?.revision ?? null, revision: storedAfterRestart.revision }
    await openCanvas(second, saved.id)
    const viewportAfter = await viewportTransform(second)
    assert.deepEqual(viewportAfter, viewportBefore, `重启后视口应恢复：${JSON.stringify({ viewportBefore, viewportAfter })}`)
    assert.deepEqual(await nodeTranslate(second, uploadId), afterDrag, '重启后节点在拖动后的位置')
    // 点画布左侧空白处取得焦点（左上角是“返回画布列表”）
    const secondPane = await second.locator('.react-flow__pane').first().boundingBox()
    await second.mouse.click(secondPane.x + 160, secondPane.y + secondPane.height / 2)
    await second.keyboard.press('Control+z')
    await waitUntil(async () => JSON.stringify(await nodeTranslate(second, uploadId)) === JSON.stringify(beforeDrag), '重启后 Ctrl+Z 撤回上次拖动', 5000)
    assert.ok(await second.locator('.react-flow__node').count() >= 3, '上传节点、生成节点与生成结果都在')
    await shot('paper-canvas-restored')
    await clickBack(second)
    await button(second, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    currentRun.restored = { viewport: viewportAfter, undo: true }

    // —— 多图层画布移进新项目：内嵌包随画布复制 ——
    await contextMenuAction(second, layered.canvasId, '移到项目…')
    const moveDialog = second.getByRole('dialog').last()
    await moveDialog.getByText('新建项目', { exact: true }).click()
    await moveDialog.getByRole('textbox', { name: '新项目名称' }).fill('图层项目')
    await second.waitForTimeout(400)
    await moveDialog.getByRole('button', { name: '移入', exact: true }).click()
    await waitUntil(async () => (await listCanvases(second)).some((document) => document.id === layered.canvasId && document.projectName === '图层项目'), '移到项目完成')
    const projectFolder = path.join(workRoot, '项目', '图层项目')
    const movedPath = path.join(projectFolder, '多图层画布.henji-canvas')
    const movedPackage = path.join(projectFolder, '.henji', 'canvas-layers', `${documentId}.henjilayer`)
    assert.ok(fs.existsSync(movedPath), `画布应移进项目文件夹：${movedPath}`)
    assert.ok(fs.existsSync(movedPackage), `内嵌图片文档包应随画布复制进项目：${movedPackage}`)
    assert.equal(readEnvelope(movedPath).content.layerPackages?.[documentId], `henji:/.henji/canvas-layers/${documentId}.henjilayer`)
    const movedRef = await openLayerCanvas(second, layered.canvasId, layered.nodeId)
    assert.equal(movedRef, layered.documentRef, '移动不换图层文档')
    assert.deepEqual((await loadLayers(second, movedRef)).layers, edited.layers, '移动后图层与改过的不透明度都在')
    await clickBack(second)
    await button(second, '新建画布').waitFor({ state: 'visible', timeout: 15000 })

    // —— 创建副本：打开时分出自己的图层文档 ——
    await contextMenuAction(second, layered.canvasId, '创建副本')
    await waitUntil(async () => (await listCanvases(second)).filter((document) => document.name.startsWith('多图层画布')).length === 2, '创建副本完成')
    const duplicate = (await listCanvases(second)).find((document) => document.name.startsWith('多图层画布') && document.id !== layered.canvasId)
    assert.equal(path.dirname(duplicate.path), projectFolder, '副本与原件在同一文件夹')
    const duplicateRef = await openLayerCanvas(second, duplicate.id, layered.nodeId)
    assert.notEqual(duplicateRef, layered.documentRef, '副本打开时应分出自己的图层文档')
    assert.deepEqual((await loadLayers(second, duplicateRef)).layers, edited.layers, '副本的图层与不透明度完整')
    await shot('paper-duplicate-layers')
    await clickBack(second)
    await button(second, '新建画布').waitFor({ state: 'visible', timeout: 15000 })

    // —— 整个项目文件夹拷到别处后打开：同样分出，图层完整 ——
    const copiedFolder = path.join(workRoot, '项目', '图层项目 - 副本')
    fs.cpSync(projectFolder, copiedFolder, { recursive: true })
    await second.evaluate(() => window.henjiNative.documents.refreshIndex())
    // 已打开的列表不会因为外部拷贝自动刷新；重新载入界面，相当于用户之后再来到画布页
    await second.reload({ waitUntil: 'domcontentloaded' })
    await openCanvasList(second)
    const copiedPath = path.join(copiedFolder, '多图层画布.henji-canvas')
    let copied = null
    await waitUntil(async () => {
      copied = (await listCanvases(second)).find((document) => document.path === copiedPath)
      return Boolean(copied)
    }, '拷贝出来的项目里的画布进入作品索引', 15000)
    assert.notEqual(copied.id, layered.canvasId, '拷贝出来的画布换了新 ID')
    const copiedRef = await openLayerCanvas(second, copied.id, layered.nodeId)
    assert.notEqual(copiedRef, layered.documentRef, '拷贝出来的画布打开时应分出自己的图层文档')
    assert.deepEqual((await loadLayers(second, copiedRef)).layers, edited.layers, '拷贝出来的画布图层完整')
    await clickBack(second)
    await button(second, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    // 原画布照旧用原来的图层文档
    assert.equal(await openLayerCanvas(second, layered.canvasId, layered.nodeId), layered.documentRef)
    await clickBack(second)
    await button(second, '新建画布').waitFor({ state: 'visible', timeout: 15000 })
    await shot('paper-list-final')
    currentRun.layers = { movedPath, movedPackage, duplicate: { id: duplicate.id, documentRef: duplicateRef }, copied: { id: copied.id, documentRef: copiedRef } }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第二次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    evidence.passed = true
    save()
    console.log(`✓ 画布文档接入真实验收通过，证据：${evidenceFile}`)
  } catch (error) {
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error)
    save()
    if (current) await shot('failed').catch((captureError) => { evidence.failureCaptureError = captureError.message; save() })
    throw error
  } finally {
    collector?.dispose()
    await closeCurrent().catch((error) => { evidence.cleanupError = error.message; save() })
    save()
  }
  return evidence
}

module.exports = { runCanvasDocumentsRestart }
