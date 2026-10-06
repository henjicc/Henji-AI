const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')
const { readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')
const { createPlaybackFixture } = require('./uiInspectionCameraStagePlayback.cjs')

/*
 * 4.1 自由组合的真实 Electron 验收（npm run test:reality -- --suite restart --only free-composition），
 * 跑在 mcp-restart-check 的同一套隔离资料目录与两次完整启动上，零付费：
 *
 * 第一次启动（石墨）：新建项目并打开剪辑 →
 *   项目文档面板“新建画布”：草稿建在项目里、嵌入模式（命令带“返回剪辑 · 项目名”）、返回时空草稿直接删掉回到剪辑；
 *   打开项目里的画布（嵌入）→ 三维节点本地渲染出正式结果 → 节点“加入剪辑” → 返回剪辑：片段来源 = 画布 + 节点；
 *   “新建口播”（导入音频即建草稿，在项目里）→ “加入剪辑 · 加入播放头”（剪后声音写进项目“生成结果”）→ 返回时起名保存；
 *   “新建图片文档”（按序列尺寸的空白图，在项目里）→ 改不透明度 → 加入剪辑 → 返回时起名保存；
 *   双击图片片段回到来源（图片编辑嵌入打开）→ 再改 → 返回：写回后剪辑自动重新渲染该片段（来源版本前进、换新渲染）；
 *   右键画布片段“回到来源继续编辑”→ 画布嵌入打开；
 *   作品目录里的口播（别处）从“打开其他位置的文档…”嵌入打开并加入剪辑 → 面板标出“来自其他位置”→ “收集素材到项目”
 *   复制进项目（新 ID）并改指向副本；另一份别处画布“移进本项目”；
 *   项目列表右键“导出为单个文件…”（整个项目）。
 * 第二次启动（纸白）：项目列表“导入单个文件…”导入刚才的包 → 新项目（换新 ID）→ 打开：片段来源都在新项目里、素材一个不缺。
 *
 * 文件对话框、回收站在主进程里换成替身（只影响这个隔离实例）。
 */

const WINDOW_SIZE = { width: 1440, height: 900 }
const PROJECT_NAME = '组合项目'
const STAGE_NODE_ID = '__free_composition_stage'

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

/** 主进程替身：回收站记录、文件打开 / 保存对话框返回给定位置。 */
async function stubShell(app, recycleDir) {
  await app.evaluate(({ shell }, recycle) => {
    const nodeFs = process.mainModule.require('node:fs')
    const nodePath = process.mainModule.require('node:path')
    globalThis.__henjiRealityShell = { trashed: [], revealed: [] }
    shell.trashItem = async (target) => {
      nodeFs.mkdirSync(recycle, { recursive: true })
      nodeFs.renameSync(target, nodePath.join(recycle, `${Date.now()}-${nodePath.basename(target)}`))
      globalThis.__henjiRealityShell.trashed.push(target)
    }
    shell.showItemInFolder = (target) => { globalThis.__henjiRealityShell.revealed.push(target) }
  }, recycleDir)
}
async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, values) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: values }) }, paths)
}
async function stubSaveDialog(app, filePath) {
  await app.evaluate(({ dialog }, value) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: value }) }, filePath)
}

async function waitUntil(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
const same = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
const inside = (folder, file) => path.resolve(file).toLowerCase().startsWith(`${path.resolve(folder).toLowerCase()}${path.sep}`)
const returnButton = (page) => page.getByRole('button', { name: `返回剪辑 · ${PROJECT_NAME}`, exact: true }).filter({ visible: true }).first()

function listDocuments(page, query) {
  return page.evaluate((value) => window.henjiNative.documents.listDocuments(value), query)
}
function listProjects(page) {
  return page.evaluate(() => window.henjiNative.documents.listProjects({ includeDrafts: true, includeMissing: true }))
}

async function openEditPage(page) {
  await page.getByRole('button', { name: /^(剪辑|Edit)$/ }).filter({ visible: true }).first().click()
  await button(page, '新建项目').or(button(page, '关闭项目')).first().waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(400)
}

async function openProjectCard(page, projectId) {
  await openEditPage(page)
  const card = page.locator(`[data-project-id="${projectId}"]:visible`).first()
  if (!await card.waitFor({ state: 'visible', timeout: 2000 }).then(() => true, () => false)) {
    await page.getByRole('button', { name: /^(生成|Generate)$/ }).filter({ visible: true }).first().click()
    await openEditPage(page)
    await card.waitFor({ state: 'visible', timeout: 15000 })
  }
  await card.click()
  await button(page, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
}

/** 项目文档面板（剪辑素材面板里的“项目文档”）里点一项。 */
async function projectDocumentsAction(page, label) {
  await page.locator('[data-video-edit-project-documents]:visible').first().click()
  const item = page.getByRole('button', { name: label }).filter({ visible: true }).first()
  await item.waitFor({ state: 'visible', timeout: 10000 })
  await item.click()
}

/** 嵌入模式的返回；草稿会询问，按 save 起名保存（null 表示不应询问）。 */
async function returnToEdit(page, save) {
  await returnButton(page).click()
  const prompt = page.getByRole('alertdialog')
  const appeared = await prompt.waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)
  if (appeared) {
    assert.ok(save, '已保存的文档返回剪辑时不应询问')
    await prompt.getByRole('button', { name: '保存', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last()
    const input = dialog.getByRole('textbox').first()
    await input.waitFor({ state: 'visible', timeout: 8000 })
    await input.fill(save)
    await waitUntil(async () => !(await dialog.getByRole('button', { name: '保存', exact: true }).isDisabled()), '名称可用', 8000)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
  }
  await button(page, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
}

async function clipWhere(file, predicate, label, timeout = 30000) {
  let found = null
  await waitUntil(() => {
    const document = readVideoEditFile(file)
    const clip = document.sequences.flatMap((sequence) => sequence.clips).find((value) => predicate(value, document))
    if (!clip) return false
    found = { document, clip, media: document.media.find((media) => media.id === document.items.find((item) => item.id === clip.itemId)?.mediaId) }
    return true
  }, label, timeout)
  return found
}

async function opacitySlider(page) {
  const tab = page.getByRole('tab', { name: '基础', exact: true }).filter({ visible: true }).first()
  if (await tab.count()) await tab.click()
  const slider = page.getByRole('slider', { name: '不透明度' }).filter({ visible: true }).first()
  await slider.waitFor({ state: 'visible', timeout: 15000 })
  return slider
}
async function nudgeOpacity(page) {
  const slider = await opacitySlider(page)
  await slider.focus()
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(800)
}

async function sendToEditAtPlayhead(page, mode = /加入播放头/) {
  await page.getByRole('button', { name: /加入剪辑/ }).filter({ visible: true }).first().click()
  const item = page.getByRole('menuitem', { name: mode }).first()
  await item.waitFor({ state: 'visible', timeout: 10000 })
  await item.click()
}

function makeMedia(dir) {
  const { ffmpegPath } = require('./mediaBinaries.cjs')
  fs.mkdirSync(dir, { recursive: true })
  const voice = path.join(dir, '旁白 素材.wav')
  if (!fs.existsSync(voice)) execFileSync(ffmpegPath, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4:sample_rate=48000', '-ac', '2', '-c:a', 'pcm_s16le', voice], { windowsHide: true, timeout: 60000 })
  return { voice }
}

/** 复用 mcp-restart-check 的启动器与隔离资料目录，不另建 Electron 启动链。 */
async function runFreeCompositionRestart({ launch, userDataDir, outDir }) {
  const evidenceFile = path.join(outDir, 'free-composition-restart.json')
  const documentsRoot = path.join(userDataDir, 'app-data', 'Documents')
  const recycleDir = path.join(userDataDir, 'recycle')
  const outside = path.join(userDataDir, '外部位置')
  const media = makeMedia(path.join(outside, '素材来源'))
  const packagePath = path.join(outside, '导出包', `${PROJECT_NAME}.henjipack`)
  const evidence = { target: 'free-composition', userDataDir, documentsRoot, passed: false, firstRun: {}, secondRun: {} }
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
    await stubShell(current.app, recycleDir)
    collector = createRuntimeEvidenceCollector(current.page)
  }
  // 截图前等进出场动画与工作区切换结束，避免拍到半透明的浮层或尚未绘制的页面
  const settle = async () => {
    await current.page.evaluate(async () => {
      const running = () => document.getAnimations().filter((animation) => animation.playState === 'running' && !(animation.effect && animation.effect.getComputedTiming().iterations === Infinity))
      const deadline = Date.now() + 3000
      while (running().length && Date.now() < deadline) await Promise.race([Promise.all(running().map((animation) => animation.finished.catch(() => undefined))), new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())))])
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await current.page.waitForTimeout(250)
  }
  const shot = async (name) => { await settle(); return capture(current, path.join(outDir, `free-composition-${name}.png`), currentRun) }
  const step = (name) => { currentRun.step = name; save() }

  try {
    // ==================== 第一次启动：石墨 ====================
    await start(['--dev-theme-preset=graphite'])
    collector.begin('free-composition-first')
    const { page, app } = current
    step('create-project')
    const project = await page.evaluate((name) => window.henjiNative.documents.createProject({ name }), PROJECT_NAME)
    const container = { kind: 'project', projectId: project.id }
    await openProjectCard(page, project.id)
    const edit = (await listDocuments(page, { kind: 'video_edit', container })).find((document) => document.id)
    assert.ok(edit, '打开项目后应有主剪辑')
    const editFile = edit.path
    currentRun.project = { id: project.id, path: project.path, editFile }

    // ---- 新建画布：草稿建在项目里，嵌入模式，返回时空草稿直接删掉 ----
    step('create-canvas-embedded')
    await projectDocumentsAction(page, '新建画布')
    await returnButton(page).waitFor({ state: 'visible', timeout: 30000 })
    const draftCanvas = (await listDocuments(page, { kind: 'canvas', container, includeDrafts: true })).find((document) => document.draft)
    assert.ok(draftCanvas && inside(project.path, draftCanvas.path), `剪辑里新建的画布应是项目里的草稿：${JSON.stringify(draftCanvas)}`)
    await page.locator('.react-flow__pane').first().waitFor({ state: 'visible', timeout: 15000 })
    await shot('graphite-canvas-embedded')
    await returnToEdit(page, null)
    assert.equal((await listDocuments(page, { kind: 'canvas', container, includeDrafts: true })).length, 0, '空的画布草稿返回剪辑时应直接删掉')

    // ---- 项目里的画布：三维节点本地渲染出正式结果，放回剪辑 ----
    step('canvas-result-to-edit')
    const stage = await page.evaluate(async ({ projectId, scene, nodeId }) => {
      const documents = window.henjiNative.documents
      const { schemaVersion: _version, ...content } = scene
      const stageDoc = await documents.createDocument({ kind: 'camera_stage', container: { kind: 'project', projectId }, name: '组合镜头', content })
      const node = { id: nodeId, type: 'cameraStageNode', position: { x: 220, y: 160 }, width: 480, height: 320, measured: { width: 480, height: 320 }, style: { width: 480, height: 320 },
        data: { displayName: '组合镜头', projectId: stageDoc.meta.id, imageUrl: null, previewImageUrl: null, videoUrl: null, aspectRatio: '16:9', durationSec: null, selectedTimeSec: 0.25, mediaInputs: {}, environmentImageUrl: null, imageExporting: false, imageRenderRequestId: null, imageRenderError: null, videoProgress: null, videoExporting: false, videoRenderPhase: null, videoRenderRequestId: null, videoRenderError: null, renderTask: null, outputKind: 'image' } }
      const created = await window.henjiNative.testFixtures.createCanvas({ name: '组合画布', nodes: [node], viewport: { x: 180, y: 100, zoom: 0.8 }, container: { kind: 'project', projectId } })
      return { canvasId: created.id }
    }, { projectId: project.id, scene: createPlaybackFixture(), nodeId: STAGE_NODE_ID })
    await projectDocumentsAction(page, /组合画布/)
    await returnButton(page).waitFor({ state: 'visible', timeout: 30000 })
    const stageNode = page.locator(`.react-flow__node[data-id="${STAGE_NODE_ID}"]`)
    await stageNode.waitFor({ state: 'visible', timeout: 20000 }); await stageNode.click()
    await page.getByRole('button', { name: /输出图片|Output Image/i }).click()
    let resultNodeId = null
    await waitUntil(async () => {
      resultNodeId = await page.evaluate(async (canvasId) => {
        const stored = await window.henjiNative.testFixtures.readCanvas(canvasId)
        return (stored?.nodes ?? []).find((node) => node.data?.cameraStageRenderReceipt && node.data?.generationOutputCommitId)?.id ?? null
      }, stage.canvasId)
      return Boolean(resultNodeId)
    }, '三维节点渲染出正式结果节点', 90000)
    const resultNode = page.locator(`.react-flow__node[data-id="${resultNodeId}"]`)
    await resultNode.waitFor({ state: 'visible', timeout: 15000 }); await resultNode.click()
    await page.getByRole('button', { name: '加入剪辑', exact: true }).click()
    const canvasClip = await clipWhere(editFile, (clip) => clip.creativeSource?.type === 'document' && clip.creativeSource.part === resultNodeId, '画布结果放回剪辑')
    assert.equal(canvasClip.clip.creativeSource.docRef.docId, stage.canvasId)
    assert.ok(inside(path.join(project.path, '生成结果'), canvasClip.media.path), `画布结果应复制进项目“生成结果”：${canvasClip.media.path}`)
    await returnToEdit(page, null)
    currentRun.canvas = { canvasId: stage.canvasId, resultNodeId, clip: canvasClip.clip.id }

    // ---- 新建口播：导入音频即建草稿（在项目里），加入剪辑，返回时起名 ----
    step('voice')
    await stubOpenDialog(app, [media.voice])
    await projectDocumentsAction(page, '新建口播')
    await returnButton(page).waitFor({ state: 'visible', timeout: 30000 })
    const voiceDraft = (await listDocuments(page, { kind: 'audio_edit', container, includeDrafts: true }))[0]
    assert.ok(voiceDraft?.draft && inside(project.path, voiceDraft.path), '剪辑里新建的口播应是项目里的草稿')
    await sendToEditAtPlayhead(page)
    const voiceClip = await clipWhere(editFile, (clip) => clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === voiceDraft.id, '口播放回剪辑', 60000)
    assert.ok(inside(path.join(project.path, '生成结果'), voiceClip.media.path), `剪后声音应写进项目“生成结果”：${voiceClip.media.path}`)
    await returnToEdit(page, '片头口播')
    currentRun.voice = { id: voiceDraft.id, clip: voiceClip.clip.id }
    const voiceAfter = (await listDocuments(page, { kind: 'audio_edit', container, includeDrafts: true })).map((document) => ({ id: document.id, name: document.name, draft: document.draft, path: document.path }))
    currentRun.voice.after = voiceAfter
    assert.ok(voiceAfter.some((document) => document.id === voiceDraft.id && !document.draft), `返回剪辑后口播应按起的名字保存：${JSON.stringify(voiceAfter)}`)

    // ---- 新建图片文档：按序列尺寸的空白图（在项目里），改一下，加入剪辑 ----
    step('image-document')
    await projectDocumentsAction(page, '新建图片文档')
    await returnButton(page).waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('[data-image-editor-v3]').first().waitFor({ state: 'visible', timeout: 30000 })
    const imageDraft = (await listDocuments(page, { kind: 'image_document', container, includeDrafts: true }))[0]
    assert.ok(imageDraft?.draft && inside(project.path, imageDraft.path), '剪辑里新建的图片文档应是项目里的草稿')
    assert.equal(imageDraft.summary.width, 1920); assert.equal(imageDraft.summary.height, 1080)
    await nudgeOpacity(page)
    await sendToEditAtPlayhead(page)
    const imageClip = await clipWhere(editFile, (clip) => clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === imageDraft.id, '图片文档放回剪辑', 60000)
    await shot('graphite-image-embedded')
    await returnToEdit(page, '片头图片')
    const firstRevision = imageClip.clip.creativeSource.revision
    currentRun.image = { id: imageDraft.id, clip: imageClip.clip.id, firstRevision, firstMedia: imageClip.media.path }

    // ---- 双击图片片段回到来源，改完返回：写回后剪辑自动重新渲染 ----
    step('image-relink')
    await page.locator(`[data-video-edit-clip="${imageClip.clip.id}"]`).first().dblclick()
    await returnButton(page).waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('[data-image-editor-v3]').first().waitFor({ state: 'visible', timeout: 30000 })
    await nudgeOpacity(page)
    await returnToEdit(page, null)
    const rerendered = await clipWhere(editFile, (clip) => clip.id === imageClip.clip.id && clip.creativeSource?.revision !== firstRevision, '图片文档写回后剪辑自动重新渲染', 60000)
    assert.notEqual(rerendered.media.path, imageClip.media.path, '重新渲染后片段应换用新渲染')
    assert.equal(rerendered.clip.start, imageClip.clip.start); assert.equal(rerendered.clip.duration, imageClip.clip.duration)
    currentRun.image.rerendered = { revision: rerendered.clip.creativeSource.revision, media: rerendered.media.path }

    // ---- 右键画布片段“回到来源继续编辑”：画布嵌入打开 ----
    step('canvas-source')
    await page.locator(`[data-video-edit-clip="${canvasClip.clip.id}"]`).first().click({ button: 'right' })
    await page.getByText('回到来源继续编辑', { exact: true }).click()
    await returnButton(page).waitFor({ state: 'visible', timeout: 30000 })
    await page.locator(`.react-flow__node[data-id="${resultNodeId}"]`).waitFor({ state: 'visible', timeout: 15000 })
    await returnToEdit(page, null)

    // ---- 别处的口播：打开其他位置的文档（嵌入）→ 替换剪辑里的口播片段 → 标出“来自其他位置”→ 收集素材复制进项目 ----
    // （序列只有一条音频轨，播放头处已有口播片段：先选中它，再用“替换所选片段”放回）
    step('elsewhere-collect')
    await page.locator(`[data-video-edit-clip="${voiceClip.clip.id}"]`).first().click()
    const elsewhere = await page.evaluate(async (voiceId) => {
      const documents = window.henjiNative.documents
      const source = await documents.readDocument({ id: voiceId })
      const voice = await documents.createDocument({ kind: 'audio_edit', container: { kind: 'user' }, name: '别处口播', content: source.content })
      const canvas = await documents.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '别处画布', content: { nodes: [{ id: 'n1', type: 'textNode', position: { x: 0, y: 0 }, data: { text: '别处' } }], edges: [] } })
      return { voiceId: voice.meta.id, voicePath: voice.meta.path, canvasId: canvas.meta.id }
    }, voiceDraft.id)
    await projectDocumentsAction(page, '打开其他位置的文档…')
    const dialog = page.getByRole('dialog').filter({ hasText: '打开其他位置的文档' }).last()
    await dialog.waitFor({ state: 'visible', timeout: 10000 })
    await dialog.getByRole('option', { name: /别处口播/ }).click()
    await shot('graphite-open-elsewhere')
    await dialog.getByRole('button', { name: '打开', exact: true }).click()
    await returnButton(page).waitFor({ state: 'visible', timeout: 30000 })
    await sendToEditAtPlayhead(page, /替换所选片段/)
    await clipWhere(editFile, (clip) => clip.id === voiceClip.clip.id && clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === elsewhere.voiceId, '别处口播替换剪辑里的口播片段', 60000)
    await returnToEdit(page, null)
    await page.locator('[data-video-edit-project-documents]:visible').first().click()
    await page.getByText('来自其他位置', { exact: true }).first().waitFor({ state: 'visible', timeout: 10000 })
    await shot('graphite-documents-elsewhere')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: `项目 ${PROJECT_NAME}`, exact: true }).click()
    await page.getByText('收集素材到项目', { exact: true }).click()
    const collected = await clipWhere(editFile, (clip) => clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId !== elsewhere.voiceId && /别处口播/.test(clip.creativeSource.docRef.path), '收集后片段改指向项目里的副本', 30000)
    assert.ok(inside(project.path, collected.clip.creativeSource.docRef.path), `收集后片段来源应在项目里：${collected.clip.creativeSource.docRef.path}`)
    assert.ok(fs.existsSync(elsewhere.voicePath), '收集不动别处的原文档')
    // 别处画布移进本项目
    await projectDocumentsAction(page, '打开其他位置的文档…')
    await dialog.waitFor({ state: 'visible', timeout: 10000 })
    await dialog.getByRole('option', { name: /别处画布/ }).click()
    await dialog.getByRole('button', { name: '移进本项目', exact: true }).click()
    await waitUntil(async () => (await listDocuments(page, { kind: 'canvas', container })).some((document) => document.id === elsewhere.canvasId), '别处画布移进本项目')
    currentRun.elsewhere = { ...elsewhere, collectedDocId: collected.clip.creativeSource.docRef.docId }

    // ---- 导出整个项目为单个文件（项目列表右键） ----
    step('export-package')
    await button(page, '关闭项目').click()
    await button(page, '新建项目').waitFor({ state: 'visible', timeout: 30000 })
    fs.mkdirSync(path.dirname(packagePath), { recursive: true })
    await stubSaveDialog(app, packagePath)
    await page.locator(`[data-project-id="${project.id}"]:visible`).first().click({ button: 'right' })
    await page.getByText('导出为单个文件…', { exact: true }).click()
    await page.getByText(`已导出“${PROJECT_NAME}.henjipack”。`).waitFor({ state: 'visible', timeout: 60000 })
    assert.ok(fs.existsSync(packagePath), '单文件包应写到选的位置')
    currentRun.package = { path: packagePath, bytes: fs.statSync(packagePath).size }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()

    // ==================== 第二次启动：纸白，导入包后打开完整 ====================
    currentRun = evidence.secondRun
    await start(['--dev-theme-preset=paper'])
    collector.begin('free-composition-second')
    const second = current.page
    step('import-package')
    await openEditPage(second)
    const before = new Set((await listProjects(second)).map((item) => item.id))
    await stubOpenDialog(current.app, [packagePath])
    await button(second, '导入单个文件…').click()
    await second.getByText(/已导入项目“组合项目 \(2\)”/).waitFor({ state: 'visible', timeout: 60000 })
    const imported = (await listProjects(second)).find((item) => !before.has(item.id))
    assert.ok(imported && imported.name === `${PROJECT_NAME} (2)`, `导入后应多一个项目：${JSON.stringify(imported)}`)
    assert.notEqual(imported.id, project.id, '导入的项目应换新 ID（原项目还在）')
    const importedDocs = await listDocuments(second, { container: { kind: 'project', projectId: imported.id } })
    for (const kind of ['video_edit', 'canvas', 'audio_edit', 'camera_stage', 'image_document']) assert.ok(importedDocs.some((document) => document.kind === kind), `导入的项目里应有 ${kind}`)
    for (const document of importedDocs) assert.ok(!document.missing && inside(imported.path, document.path), `导入的文档应在新项目里：${document.path}`)
    await shot('paper-imported-list')
    await second.locator(`[data-project-id="${imported.id}"]:visible`).first().click()
    await button(second, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
    const importedEdit = importedDocs.find((document) => document.kind === 'video_edit')
    const read = await second.evaluate((id) => window.henjiNative.documents.readDocument({ id }), importedEdit.id)
    assert.equal(read.missingPaths.length, 0, `导入的剪辑不应缺素材：${read.missingPaths.join('、')}`)
    const sources = read.content.sequences.flatMap((sequence) => sequence.clips).map((clip) => clip.creativeSource).filter((source) => source?.type === 'document')
    assert.ok(sources.length >= 3, '导入的剪辑应保留全部片段来源（画布、图片文档、口播）')
    for (const source of sources) {
      const resolved = await second.evaluate((link) => window.henjiNative.documents.resolveDocumentLink(link), source.docRef)
      assert.equal(resolved.status, 'found', `片段来源在导入的项目里应找得到：${JSON.stringify(source.docRef)}`)
      assert.ok(inside(imported.path, resolved.meta.path), `片段来源应指向导入项目里的副本：${resolved.meta.path}`)
    }
    await second.locator('[data-video-edit-project-documents]:visible').first().click()
    await second.getByText('片头口播').first().waitFor({ state: 'visible', timeout: 10000 })
    await shot('paper-imported-documents')
    await second.keyboard.press('Escape')
    currentRun.imported = { projectId: imported.id, documents: importedDocs.map((document) => ({ kind: document.kind, name: document.name })), sources: sources.length }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第二次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    evidence.passed = true
    save()
    console.log(`✓ 自由组合真实验收通过，证据：${evidenceFile}`)
  } catch (error) {
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error)
    save()
    if (current) await shot('failed').catch((captureError) => { evidence.failureCaptureError = captureError.message; save() })
    if (current) {
      // 失败时把这次启动以来的警告与错误一并留进证据（隔离资料目录结束后会被删掉）
      currentRun.failureLogs = await queryApplicationLogs(current.page, { afterTimestamp: currentRun.startedAt, endTimestamp: new Date().toISOString(), level: 'warn' }).catch((logError) => String(logError))
      save()
    }
    throw error
  } finally {
    collector?.dispose()
    await closeCurrent().catch((error) => { evidence.cleanupError = error.message; save() })
    save()
  }
  return evidence
}

module.exports = { runFreeCompositionRestart }
