const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')
const { readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

/*
 * 4.4 全流程验收里“更换作品目录”这一段的真实 Electron 验收
 * （npm run test:reality -- --suite restart --only work-root），跑在 mcp-restart-check 的同一套隔离资料目录上，零付费：
 *
 * 第一次启动（石墨）：首启在隔离“文档”下建作品目录 → 经正式文档接口建项目，在项目里建画布 / 口播 / 镜头参考，
 *   作品目录里建一份独立画布并移进项目、再把口播移出项目（移入移出）→ 打开项目（主剪辑）→ 导入一个外部图片与一个
 *   复制进项目“素材”的图片 → 生成记录里登记一条结果在作品目录“生成结果”里的记录 →
 *   设置 › 文件与下载 › 作品目录 → 更换位置…（系统选文件夹换成替身，选另一个盘上的空文件夹，真实跨盘复制）→
 *   确认“移动并重新启动”：主进程移动后调用 app.relaunch 并退出（relaunch 换成记录替身，由本脚本用同一资料目录重新启动）。
 * 第二次启动（纸白）：设置里显示新位置；旧位置已删除；项目、各文档、生成记录、素材都按新位置解析且文件都在；
 *   剪辑打开不缺素材，外部素材仍指向原文件；生成页能看到那条记录。
 *
 * 回收站与“在文件夹中显示”在主进程里换成记录替身；目标文件夹放在仓库的 .reality 下（与隔离资料目录不在同一个盘时即真实跨盘），
 * 结束后删除。
 */

const WINDOW_SIZE = { width: 1440, height: 900 }
const PROJECT_NAME = '全流程项目'
const SAMPLE_IMAGE = path.resolve(__dirname, '../../resources/icons/32x32.png')

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

/** 主进程替身：回收站记录、在文件夹中显示记录、重新启动只记下请求（真正的第二次启动由本脚本完成）。 */
async function stubShell(app, recycleDir, relaunchMarker) {
  await app.evaluate(({ shell, app: electronApp }, { recycle, marker }) => {
    const nodeFs = process.mainModule.require('node:fs')
    const nodePath = process.mainModule.require('node:path')
    globalThis.__henjiRealityShell = { trashed: [], revealed: [] }
    shell.trashItem = async (target) => {
      nodeFs.mkdirSync(recycle, { recursive: true })
      nodeFs.renameSync(target, nodePath.join(recycle, `${Date.now()}-${nodePath.basename(target)}`))
      globalThis.__henjiRealityShell.trashed.push(target)
    }
    shell.showItemInFolder = (target) => { globalThis.__henjiRealityShell.revealed.push(target) }
    shell.openPath = async (target) => { globalThis.__henjiRealityShell.revealed.push(target); return '' }
    electronApp.relaunch = () => { nodeFs.writeFileSync(marker, new Date().toISOString()) }
  }, { recycle: recycleDir, marker: relaunchMarker })
}

async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, values) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: values }) }, paths)
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
const inside = (folder, file) => path.resolve(file).toLowerCase().startsWith(`${path.resolve(folder).toLowerCase()}${path.sep}`)
const listDocuments = (page, query) => page.evaluate((value) => window.henjiNative.documents.listDocuments(value), query)
const listProjects = (page) => page.evaluate(() => window.henjiNative.documents.listProjects({ includeDrafts: true, includeMissing: true }))

async function openEditPage(page) {
  await page.getByRole('button', { name: /^(剪辑|Edit)$/ }).filter({ visible: true }).first().click()
  await button(page, '新建项目').or(button(page, '关闭项目')).first().waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(400)
}

async function openProjectCard(page, projectId) {
  await openEditPage(page)
  const card = page.locator(`[data-project-id="${projectId}"]:visible`).first()
  await card.waitFor({ state: 'visible', timeout: 15000 })
  await card.click()
  await button(page, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
}

/** 设置 › 文件与下载（作品目录在这一页）。 */
async function openWorkRootSettings(page) {
  await page.getByRole('button', { name: /^(设置|Settings)$/ }).filter({ visible: true }).first().click()
  const dialog = page.getByRole('dialog', { name: /设置|Settings/ })
  await dialog.waitFor({ state: 'visible', timeout: 8000 })
  await dialog.getByText('文件与下载', { exact: true }).first().click()
  await button(page, '更换位置…').waitFor({ state: 'visible', timeout: 8000 })
  await page.waitForTimeout(400)
  return dialog
}

/** 复用 mcp-restart-check 的启动器与隔离资料目录，不另建 Electron 启动链。 */
async function runWorkRootRestart({ launch, userDataDir, outDir }) {
  const evidenceFile = path.join(outDir, 'work-root-restart.json')
  const documentsRoot = path.join(userDataDir, 'app-data', 'Documents')
  const oldRoot = path.join(documentsRoot, '痕迹AI')
  const recycleDir = path.join(userDataDir, 'recycle')
  const relaunchMarker = path.join(userDataDir, 'relaunch-requested')
  const outside = path.join(userDataDir, '外部位置')
  // 目标放在仓库的 .reality 下：隔离资料目录在系统临时目录（通常 C 盘），仓库在别的盘时就是真实的跨盘移动
  const targetParent = path.resolve(__dirname, '../../.reality', `work-root-${Date.now()}`)
  const newRoot = path.join(targetParent, '新的作品目录')
  const evidence = { target: 'work-root', userDataDir, oldRoot, newRoot, crossDrive: path.parse(oldRoot).root.toLowerCase() !== path.parse(newRoot).root.toLowerCase(), passed: false, firstRun: {}, secondRun: {} }
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
    await stubShell(current.app, recycleDir, relaunchMarker)
    collector = createRuntimeEvidenceCollector(current.page)
  }
  const settle = async () => {
    await current.page.evaluate(async () => {
      const running = () => document.getAnimations().filter((animation) => animation.playState === 'running' && !(animation.effect && animation.effect.getComputedTiming().iterations === Infinity))
      const deadline = Date.now() + 3000
      while (running().length && Date.now() < deadline) await Promise.race([Promise.all(running().map((animation) => animation.finished.catch(() => undefined))), new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now())))])
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    })
    await current.page.waitForTimeout(250)
  }
  const shot = async (name) => { await settle(); return capture(current, path.join(outDir, `work-root-${name}.png`), currentRun) }
  const step = (name) => { currentRun.step = name; save() }

  try {
    fs.mkdirSync(newRoot, { recursive: true })
    const externalImage = path.join(outside, '外部图片.png')
    fs.mkdirSync(outside, { recursive: true })
    fs.copyFileSync(SAMPLE_IMAGE, externalImage)

    // ==================== 第一次启动：石墨 ====================
    await start(['--dev-theme-preset=graphite'])
    collector.begin('work-root-first')
    const { page, app } = current

    step('first-start-folders')
    for (const folder of ['项目', '生成结果', '上传素材']) assert.ok(fs.existsSync(path.join(oldRoot, folder)), `首启应在隔离“文档/痕迹AI”下建“${folder}”`)

    step('project-documents')
    const project = await page.evaluate((name) => window.henjiNative.documents.createProject({ name }), PROJECT_NAME)
    const container = { kind: 'project', projectId: project.id }
    const created = await page.evaluate(async ({ projectId }) => {
      const documents = window.henjiNative.documents
      const inProject = { kind: 'project', projectId }
      const canvas = await documents.createDocument({ kind: 'canvas', container: inProject, name: '项目画布' })
      const voice = await documents.createDocument({ kind: 'audio_edit', container: inProject, name: '项目口播' })
      const stage = await documents.createDocument({ kind: 'camera_stage', container: inProject, name: '项目镜头' })
      const loose = await documents.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '独立画布' })
      return { canvas: canvas.meta, voice: voice.meta, stage: stage.meta, loose: loose.meta }
    }, { projectId: project.id })
    for (const meta of [created.canvas, created.voice, created.stage]) assert.ok(inside(project.path, meta.path), `项目里新建的文档应在项目文件夹里：${meta.path}`)
    assert.ok(inside(path.join(oldRoot, '画布'), created.loose.path), `独立画布应在作品目录“画布”里：${created.loose.path}`)

    step('move-in-out')
    await page.evaluate(async ({ loose, voice, projectId }) => {
      const documents = window.henjiNative.documents
      await documents.moveDocument({ target: { id: loose }, container: { kind: 'project', projectId } })
      await documents.moveDocument({ target: { id: voice }, container: { kind: 'user' } })
    }, { loose: created.loose.id, voice: created.voice.id, projectId: project.id })
    const afterMove = await listDocuments(page, { container: { kind: 'any' } })
    const located = (id) => afterMove.find((document) => document.id === id)
    assert.ok(inside(project.path, located(created.loose.id).path), '独立画布应移进项目')
    assert.ok(inside(path.join(oldRoot, '口播'), located(created.voice.id).path), '口播应移出项目到作品目录“口播”')

    step('open-project-import-media')
    await openProjectCard(page, project.id)
    const edit = (await listDocuments(page, { kind: 'video_edit', container })).find((document) => document.id)
    assert.ok(edit, '打开项目后应有主剪辑')
    const projectImage = await page.evaluate(({ projectId, source }) => window.henjiNative.documents.importFile({ container: { kind: 'project', projectId }, sourcePath: source, folder: 'materials' }), { projectId: project.id, source: SAMPLE_IMAGE })
    assert.ok(inside(project.path, projectImage.path), `复制进项目的素材应在项目“素材”里：${projectImage.path}`)
    await stubOpenDialog(app, [externalImage, projectImage.path])
    await button(page, '导入').click()
    await waitUntil(() => fs.existsSync(edit.path) && readVideoEditFile(edit.path).media.length >= 2, '导入的素材自动保存进剪辑文件', 30000)
    await button(page, '关闭项目').click()
    await button(page, '新建项目').waitFor({ state: 'visible', timeout: 30000 })

    step('generation-record')
    const generatedFile = path.join(oldRoot, '生成结果', '全流程生成结果.png')
    fs.copyFileSync(SAMPLE_IMAGE, generatedFile)
    const recordId = `work-root-${Date.now()}`
    await page.evaluate(({ id, file }) => window.henjiNative.generationHistory.insert({
      id, providerId: 'fixture', modelId: 'work-root-fixture', type: 'image', prompt: '作品目录更换验收', params: {},
      resultPaths: [file], taskId: null, status: 'completed', errorMessage: null, cost: null, duration: 1,
    }), { id: recordId, file: generatedFile })
    currentRun.before = { project, created, edit: edit.path, projectImage: projectImage.path, generatedFile, recordId }

    step('change-work-root')
    const settings = await openWorkRootSettings(page)
    await shot('graphite-settings-before')
    await stubOpenDialog(app, [newRoot])
    await button(page, '更换位置…').click()
    const confirm = page.getByRole('dialog', { name: '更换作品目录' })
    await confirm.waitFor({ state: 'visible', timeout: 10000 })
    await confirm.getByText(newRoot, { exact: false }).first().waitFor({ state: 'visible', timeout: 5000 })
    await shot('graphite-confirm')
    assert.ok(await settings.count(), '设置弹窗应仍在')
    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    const child = app.process()
    const exited = new Promise((resolve) => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve) })
    await confirm.getByRole('button', { name: '移动并重新启动', exact: true }).click()
    await limited(() => exited, 120000, '移动作品目录后应用退出重启')
    currentRun.exit = { pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode }
    current = null
    assert.ok(fs.existsSync(relaunchMarker), '移动完成后应请求重新启动')
    assert.equal(fs.existsSync(oldRoot), false, '移动完成后旧作品目录应已删除')
    assert.ok(fs.existsSync(path.join(newRoot, '项目', PROJECT_NAME)), '项目文件夹应在新作品目录里')
    save()

    // ==================== 第二次启动：纸白，全部按新位置显示 ====================
    currentRun = evidence.secondRun
    await start(['--dev-theme-preset=paper'])
    collector.begin('work-root-second')
    const second = current.page
    const relocate = (file) => path.join(newRoot, path.relative(oldRoot, file))

    step('verify-documents')
    const projects = await listProjects(second)
    const moved = projects.find((item) => item.id === project.id)
    assert.ok(moved && !moved.missing && moved.path.toLowerCase() === path.join(newRoot, '项目', PROJECT_NAME).toLowerCase(), `项目应按新位置显示且同一 ID：${JSON.stringify(moved)}`)
    const documents = await listDocuments(second, { container: { kind: 'any' }, includeDrafts: true, includeMissing: true })
    for (const id of [created.canvas.id, created.stage.id, created.loose.id, created.voice.id, edit.id]) {
      const document = documents.find((item) => item.id === id)
      assert.ok(document && !document.missing && inside(newRoot, document.path) && fs.existsSync(document.path), `文档应在新作品目录里且文件存在：${JSON.stringify(document)}`)
    }
    assert.ok(inside(path.join(newRoot, '口播'), documents.find((item) => item.id === created.voice.id).path), '移出项目的口播仍在作品目录“口播”')

    step('verify-generation-record')
    const record = await second.evaluate((id) => window.henjiNative.generationHistory.get(id), recordId)
    assert.ok(record, '生成记录应还在')
    assert.equal(record.resultPaths.length, 1)
    assert.equal(path.resolve(record.resultPaths[0]).toLowerCase(), relocate(generatedFile).toLowerCase(), `生成记录应解析到新位置：${record.resultPaths[0]}`)
    assert.ok(fs.existsSync(record.resultPaths[0]), '生成记录的结果文件应在新位置')

    step('verify-edit-media')
    const read = await second.evaluate((id) => window.henjiNative.documents.readDocument({ id }), edit.id)
    assert.equal(read.missingPaths.length, 0, `剪辑不应缺素材：${read.missingPaths.join('、')}`)
    const mediaPaths = read.content.media.map((media) => media.path)
    assert.ok(mediaPaths.some((file) => file.toLowerCase() === relocate(projectImage.path).toLowerCase()), `项目里的素材应解析到新位置：${mediaPaths.join('、')}`)
    assert.ok(mediaPaths.some((file) => file.toLowerCase() === externalImage.toLowerCase()), '外部素材仍指向原文件')
    await openProjectCard(second, project.id)
    await second.waitForTimeout(1500)
    await shot('paper-edit-after-move')
    await button(second, '关闭项目').click()
    await button(second, '新建项目').waitFor({ state: 'visible', timeout: 30000 })
    await shot('paper-project-list')

    step('package-export-import')
    // 导出不指定位置：落在新作品目录的“导出”里；再导入，得到换新 ID 的项目，也在新作品目录里
    const exported = await second.evaluate((projectId) => window.henjiNative.documents.exportProjectPackage({ projectId }), project.id)
    assert.ok(inside(path.join(newRoot, '导出'), exported.path) && fs.existsSync(exported.path), `单文件包应导出到新作品目录的“导出”里：${exported.path}`)
    const importedPackage = await second.evaluate((source) => window.henjiNative.documents.importPackage({ source }), exported.path)
    const importedProject = (await listProjects(second)).find((item) => item.id !== project.id && item.name.startsWith(PROJECT_NAME))
    assert.ok(importedProject && inside(newRoot, importedProject.path), `导入的项目应在新作品目录里：${JSON.stringify(importedProject)}`)
    const importedKinds = (await listDocuments(second, { container: { kind: 'project', projectId: importedProject.id } })).map((document) => document.kind)
    for (const kind of ['video_edit', 'canvas', 'camera_stage']) assert.ok(importedKinds.includes(kind), `导入的项目里应有 ${kind}`)
    currentRun.package = { exported: exported.path, files: exported.files, importedProjectId: importedProject.id, importedKinds, result: Object.keys(importedPackage ?? {}) }

    step('verify-settings')
    await openWorkRootSettings(second)
    const shown = second.locator('input[data-observation-sensitive]:visible').first()
    await shown.waitFor({ state: 'visible', timeout: 8000 })
    assert.equal(await shown.inputValue(), newRoot, '设置里应显示新的作品目录')
    await button(second, '恢复默认位置').waitFor({ state: 'visible', timeout: 5000 })
    await shot('paper-settings-after')
    await second.keyboard.press('Escape')

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第二次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    evidence.passed = true
    save()
    console.log(`✓ 作品目录更换真实验收通过（${evidence.crossDrive ? '跨盘复制' : '同盘改名'}），证据：${evidenceFile}`)
  } catch (error) {
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error)
    save()
    if (current) await shot('failed').catch((captureError) => { evidence.failureCaptureError = captureError.message; save() })
    if (current) {
      currentRun.failureLogs = await queryApplicationLogs(current.page, { afterTimestamp: currentRun.startedAt, endTimestamp: new Date().toISOString(), level: 'warn' }).catch((logError) => String(logError))
      save()
    }
    throw error
  } finally {
    collector?.dispose()
    await closeCurrent().catch((error) => { evidence.cleanupError = error.message; save() })
    fs.rmSync(targetParent, { recursive: true, force: true })
    save()
  }
  return evidence
}

module.exports = { runWorkRootRestart }
