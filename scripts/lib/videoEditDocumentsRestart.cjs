const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')
const { readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

/*
 * 3.1 剪辑接入的真实 Electron 验收，跑在 mcp-restart-check 的同一套隔离资料目录与两次完整启动上
 * （npm run test:reality -- --suite restart --only video-edit-documents）：
 *
 * 第一次启动（石墨）：剪辑页 = 项目列表 → 新建项目（草稿项目 + 同名主剪辑）→ 什么都没做离开直接丢弃；
 *   导入外部素材后离开：取消 / 保存（起名查重，主剪辑随项目改名）/ 保存到别处（更改位置…，登记为外部位置）/ 不保存（整个文件夹进回收站）；
 *   最后留一个有内容的草稿项目不离开，直接退出应用。
 * 第二次启动（纸白）：列表里还在、草稿项目在恢复区（移到回收站）→ 打开项目 → 收集素材（外部文件复制进“素材”、改成相对写法）
 *   → 生成页的结果“加入播放头”（复制进项目“生成结果”再引用）→ 把整个项目文件夹拷到别处，用“打开项目文件夹…”打开，素材都在（相对写法生效）。
 *
 * 数据经界面与正式文档接口造，不写 SQL。回收站与“在文件夹中显示”换成主进程里的记录替身（只影响这个隔离实例）。
 */

const WINDOW_SIZE = { width: 1440, height: 900 }

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

/** 主进程里把回收站与“在文件夹中显示”换成记录替身，并让文件对话框返回给定的位置。 */
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

async function waitUntil(check, label, timeout = 15000) {
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
const same = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase()
const inside = (folder, file) => path.resolve(file).toLowerCase().startsWith(`${path.resolve(folder).toLowerCase()}${path.sep}`)

async function listProjects(page) {
  return await page.evaluate(() => window.henjiNative.documents.listProjects({ includeDrafts: true, includeMissing: true }))
}

async function listEdits(page) {
  return await page.evaluate(() => window.henjiNative.documents.listDocuments({ kind: 'video_edit', includeDrafts: true, includeMissing: true }))
}

/** 剪辑页（项目列表）。 */
async function openEditPage(page) {
  await page.getByRole('button', { name: /^(剪辑|Edit)$/ }).filter({ visible: true }).first().click()
  await button(page, '新建项目').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(400)
}

/** 新建项目 → 进剪辑；返回新建的草稿项目与主剪辑。 */
async function createProject(page) {
  const before = new Set((await listProjects(page)).map((project) => project.id))
  await button(page, '新建项目').click()
  await button(page, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
  let project = null
  // 主剪辑在剪辑打开后登记，稍等项目说明写好
  await waitUntil(async () => {
    project = (await listProjects(page)).find((item) => !before.has(item.id) && item.mainVideoEditId) ?? null
    return Boolean(project)
  }, '新建项目并登记主剪辑')
  const main = (await listEdits(page)).find((edit) => edit.id === project.mainVideoEditId)
  assert.ok(main, `新建项目应登记主剪辑：${JSON.stringify(project)}`)
  return { project, main }
}

async function importMedia(app, page, files, mainFile) {
  await stubOpenDialog(app, files)
  await button(page, '导入').click()
  await waitUntil(() => fs.existsSync(mainFile) && readVideoEditFile(mainFile).media.length >= files.length, '导入的素材自动保存进剪辑文件', 30000)
}

async function leavePrompt(page) {
  await button(page, '关闭项目').click()
  const prompt = page.getByRole('alertdialog')
  await prompt.waitFor({ state: 'visible', timeout: 8000 })
  return prompt
}

/** 保存草稿项目：起名（可先试一个重名的）并可“更改位置…”。 */
async function saveProject(page, app, prompt, { name, duplicate, folder, shot }) {
  await prompt.getByRole('button', { name: '保存', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last()
  const input = dialog.getByRole('textbox').first()
  await input.waitFor({ state: 'visible', timeout: 8000 })
  if (folder) {
    await stubOpenDialog(app, [folder])
    await dialog.getByRole('button', { name: '更改位置…', exact: true }).click()
    await dialog.getByText(folder).first().waitFor({ state: 'visible', timeout: 5000 })
  }
  if (duplicate) {
    await input.fill(duplicate)
    await dialog.getByText('这个位置已有同名文件夹，请换一个名称。').waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(await dialog.getByRole('button', { name: '保存', exact: true }).isDisabled(), true, '重名时“保存”必须不可用')
    if (shot) await shot()
  }
  await input.fill(name)
  await waitUntil(async () => !(await dialog.getByRole('button', { name: '保存', exact: true }).isDisabled()), '名称可用')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await button(page, '新建项目').waitFor({ state: 'visible', timeout: 20000 })
}

function makeMedia(dir) {
  const { ffmpegPath } = require('./mediaBinaries.cjs')
  fs.mkdirSync(dir, { recursive: true })
  const video = path.join(dir, '外部 镜头.mp4')
  const picture = path.join(dir, '外部 封面.png')
  const generated = path.join(dir, '生成 结果.png')
  const ffmpeg = (args) => execFileSync(ffmpegPath, ['-v', 'error', '-y', ...args], { windowsHide: true, timeout: 60000 })
  if (!fs.existsSync(video)) ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video])
  if (!fs.existsSync(picture)) ffmpeg(['-f', 'lavfi', '-i', 'smptehdbars=size=640x360:rate=1', '-frames:v', '1', picture])
  if (!fs.existsSync(generated)) ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-frames:v', '1', generated])
  return { video, picture, generated }
}

/** 复用 mcp-restart-check 的启动器与隔离资料目录，不另建 Electron 启动链。 */
async function runVideoEditDocumentsRestart({ launch, userDataDir, outDir }) {
  const evidenceFile = path.join(outDir, 'video-edit-documents-restart.json')
  const documentsRoot = path.join(userDataDir, 'app-data', 'Documents')
  const recycleDir = path.join(userDataDir, 'recycle')
  const outside = path.join(userDataDir, '外部位置')
  const media = makeMedia(path.join(outside, '素材来源'))
  const evidence = { target: 'video-edit-documents', userDataDir, documentsRoot, passed: false, firstRun: {}, secondRun: {} }
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
  const shot = async (name) => capture(current, path.join(outDir, `video-edit-${name}.png`), currentRun)

  try {
    // ==================== 第一次启动：石墨 ====================
    await start(['--dev-theme-preset=graphite'])
    collector.begin('video-edit-documents-first')
    const { page, app } = current
    // 同一“项目”文件夹里已有的“剪辑查重”用来验证起名查重（经正式文档接口造）
    await page.evaluate(() => window.henjiNative.documents.createProject({ name: '剪辑查重' }))
    const workRoot = path.join(documentsRoot, '痕迹AI')
    const projectsDir = path.join(workRoot, '项目')
    assert.ok(fs.existsSync(projectsDir), `首启没有在隔离的“文档”下建“项目”文件夹：${projectsDir}`)
    await openEditPage(page)
    await shot('graphite-projects-first')

    // A. 新建后什么都没做：离开直接把草稿项目移到回收站，不询问
    const empty = await createProject(page)
    assert.equal(empty.project.draft, true, '新建的项目应是草稿')
    assert.ok(inside(projectsDir, empty.project.path), '草稿项目直接建在“项目”文件夹里')
    assert.equal(empty.main.name, empty.project.name, '主剪辑与项目同名')
    assert.equal(path.dirname(empty.main.path), empty.project.path)
    const emptyManifest = JSON.parse(fs.readFileSync(path.join(empty.project.path, '.henji', 'project.json'), 'utf8'))
    assert.equal(emptyManifest.draft, true); assert.equal(emptyManifest.mainVideoEditId, empty.main.id)
    await button(page, '关闭项目').click()
    await button(page, '新建项目').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByRole('alertdialog').count(), 0, '空的草稿项目离开时不应询问')
    assert.ok((await readShell(app)).trashed.some((item) => same(item, empty.project.path)), '空的草稿项目应整个移到回收站')

    // B. 有内容：取消留在剪辑里；保存时起名查重，主剪辑随项目改名
    const travel = await createProject(page)
    await importMedia(app, page, [media.video, media.picture], travel.main.path)
    let prompt = await leavePrompt(page)
    await shot('graphite-leave-project-prompt')
    await prompt.getByRole('button', { name: '取消', exact: true }).click()
    await button(page, '关闭项目').waitFor({ state: 'visible', timeout: 5000 })
    prompt = await leavePrompt(page)
    await saveProject(page, app, prompt, { name: '旅行短片', duplicate: '剪辑查重', shot: () => shot('graphite-save-project-duplicate') })
    const travelFolder = path.join(projectsDir, '旅行短片')
    const travelFile = path.join(travelFolder, '旅行短片.henji-video')
    await waitUntil(() => fs.existsSync(travelFile), '主剪辑随项目改名')
    const travelManifest = JSON.parse(fs.readFileSync(path.join(travelFolder, '.henji', 'project.json'), 'utf8'))
    assert.equal(travelManifest.draft, undefined, '保存后项目说明不应再有草稿标记')
    assert.equal(travelManifest.mainVideoEditId, travel.main.id, '主剪辑 ID 不变')
    const travelEnvelope = JSON.parse(fs.readFileSync(travelFile, 'utf8'))
    assert.equal(travelEnvelope.format, 'henji-document'); assert.equal(travelEnvelope.kind, 'video_edit'); assert.equal(travelEnvelope.id, travel.main.id)
    assert.deepEqual(travelEnvelope.content.media.map((item) => item.path).sort(), [media.picture, media.video].sort(), '外部素材默认引用原文件（外部绝对路径）')
    assert.equal(JSON.stringify(travelEnvelope).includes(JSON.stringify(path.join(userDataDir, 'app-data')).slice(1, -1)), false, '剪辑文件里不得出现程序目录路径')
    await card(page, travelManifest.id).waitFor({ state: 'visible', timeout: 15000 })
    currentRun.travel = { projectId: travelManifest.id, file: travelFile }

    // C. 保存时另选位置：整个项目文件夹移到别处并登记为外部位置
    const elsewhere = await createProject(page)
    await importMedia(app, page, [media.picture], elsewhere.main.path)
    const elsewhereParent = path.join(outside, '另存位置')
    fs.mkdirSync(elsewhereParent, { recursive: true })
    prompt = await leavePrompt(page)
    await saveProject(page, app, prompt, { name: '外部短片', folder: elsewhereParent })
    const elsewhereFolder = path.join(elsewhereParent, '外部短片')
    await waitUntil(() => fs.existsSync(path.join(elsewhereFolder, '外部短片.henji-video')), '另存位置的项目文件夹与主剪辑')
    assert.equal(fs.existsSync(elsewhere.project.path), false, '另选位置后原草稿文件夹应整体移走')
    const external = (await listProjects(page)).find((project) => same(project.path, elsewhereFolder))
    assert.ok(external?.external, '另选位置的项目应登记为外部位置')
    await card(page, external.id).waitFor({ state: 'visible', timeout: 15000 })

    // D. 不保存：整个项目文件夹移到回收站
    const discarded = await createProject(page)
    await importMedia(app, page, [media.picture], discarded.main.path)
    prompt = await leavePrompt(page)
    await prompt.getByRole('button', { name: '不保存', exact: true }).click()
    await button(page, '新建项目').waitFor({ state: 'visible', timeout: 15000 })
    assert.ok((await readShell(app)).trashed.some((item) => same(item, discarded.project.path)), '“不保存”应整个项目文件夹移到回收站')

    // E. 留一个有内容的草稿项目不离开，直接退出（意外退出的草稿）
    const leftover = await createProject(page)
    await importMedia(app, page, [media.picture], leftover.main.path)
    currentRun.leftover = leftover.project.id
    await shot('graphite-editor-draft')

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()

    // ==================== 第二次启动：纸白 ====================
    currentRun = evidence.secondRun
    await start(['--dev-theme-preset=paper'])
    collector.begin('video-edit-documents-second')
    const second = current.page
    const secondApp = current.app
    assert.notEqual(currentRun.pid, evidence.firstRun.pid, '必须是新的 Electron 主进程')
    await second.evaluate(async (file) => {
      await window.henjiNative.generationHistory.delete('video-edit-documents-generation')
      await window.henjiNative.generationHistory.insert({ id: 'video-edit-documents-generation', providerId: 'fixture', modelId: 'fixture-image', type: 'image', prompt: '受控生成结果',
        params: {}, resultPaths: [file], taskId: null, status: 'success', errorMessage: null, cost: null, duration: null })
    }, media.generated)
    // 生成记录在生成工作区挂载时读取：重载让造的记录进入正式列表
    await second.reload({ waitUntil: 'domcontentloaded' })
    await second.getByRole('button', { name: /^(剪辑|Edit)$/ }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 30000 })
    await openEditPage(second)
    await card(second, evidence.firstRun.travel.projectId).waitFor({ state: 'visible', timeout: 15000 })
    await card(second, external.id).waitFor({ state: 'visible', timeout: 15000 })
    await second.getByText('有 1 个草稿项目没有保存').waitFor({ state: 'visible', timeout: 15000 })
    await shot('paper-projects-after-restart')
    await second.getByRole('button', { name: '移到回收站', exact: true }).click()
    await second.getByText('有 1 个草稿项目没有保存').waitFor({ state: 'detached', timeout: 10000 })
    assert.ok((await readShell(secondApp)).trashed.some((item) => same(item, leftover.project.path)), '恢复区丢弃草稿项目应整个移到回收站')

    // 收集素材：外部文件复制进项目“素材”，剪辑文件里改成相对写法
    await card(second, evidence.firstRun.travel.projectId).click()
    await button(second, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
    await second.getByRole('button', { name: '项目 旅行短片', exact: true }).click()
    await second.getByText('收集素材到项目', { exact: true }).click()
    await second.getByText('已把 2 个文件复制进项目的素材文件夹。').waitFor({ state: 'visible', timeout: 15000 })
    const materials = path.join(travelFolder, '素材')
    for (const file of [media.video, media.picture]) {
      assert.ok(fs.existsSync(path.join(materials, path.basename(file))), `收集后素材应在项目“素材”里：${path.basename(file)}`)
      assert.ok(fs.existsSync(file), '收集不动原文件')
    }
    const collected = JSON.parse(fs.readFileSync(travelFile, 'utf8'))
    assert.deepEqual(collected.content.media.map((item) => item.path).sort(), ['henji:/素材/外部 封面.png', 'henji:/素材/外部 镜头.mp4'], '收集后剪辑文件里是项目内相对写法')

    // 生成页的结果加入剪辑：复制进项目“生成结果”再引用
    await second.getByRole('button', { name: /^(生成|Generate)$/ }).filter({ visible: true }).first().click()
    const result = second.locator('[data-generation-result="video-edit-documents-generation"]').first()
    await result.waitFor({ state: 'visible', timeout: 30000 })
    await result.click({ button: 'right' })
    await second.getByText('剪辑：加入播放头', { exact: true }).click()
    let placed = null
    const sentAt = new Date(Date.now() - 2000).toISOString()
    await waitUntil(() => {
      const document = readVideoEditFile(travelFile)
      const clip = document.sequences[0].clips.find((value) => value.creativeSource?.kind === 'generation.result')
      if (!clip) return false
      const item = document.items.find((value) => value.id === clip.itemId)
      placed = document.media.find((value) => value.id === item.mediaId)
      return Boolean(placed)
    }, '生成结果加入剪辑并保存', 30000).catch(async (error) => {
      currentRun.sendLogs = await queryApplicationLogs(second, { afterTimestamp: sentAt, endTimestamp: new Date().toISOString(), level: 'warn' }).catch((logError) => String(logError))
      save()
      throw error
    })
    assert.ok(same(path.dirname(placed.path), path.join(travelFolder, '生成结果')), `生成结果应复制进项目“生成结果”：${placed.path}`)
    assert.ok(fs.existsSync(placed.path) && fs.existsSync(media.generated), '项目里的副本与原文件都在')
    await second.getByRole('button', { name: /^(剪辑|Edit)$/ }).filter({ visible: true }).first().click()
    await shot('paper-editor-collected')
    await button(second, '关闭项目').click()
    await button(second, '新建项目').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await second.getByRole('alertdialog').count(), 0, '已保存的项目离开时不应询问')

    // 整个项目文件夹拷到别处，用“打开项目文件夹…”打开：素材都在（相对写法生效）
    const copyFolder = path.join(outside, '拷贝位置', '旅行短片拷贝')
    fs.cpSync(travelFolder, copyFolder, { recursive: true })
    await stubOpenDialog(secondApp, [copyFolder])
    await button(second, '打开项目文件夹…').click()
    await button(second, '关闭项目').waitFor({ state: 'visible', timeout: 30000 })
    const copied = (await listProjects(second)).find((project) => same(project.path, copyFolder))
    assert.ok(copied?.external, '拷来的项目文件夹应登记为外部位置')
    assert.notEqual(copied.id, evidence.firstRun.travel.projectId, '拷贝出来的项目与原项目同 ID 时应换新 ID')
    const copiedEdit = (await listEdits(second)).find((edit) => inside(copyFolder, edit.path))
    assert.ok(copiedEdit, '拷来的项目里应有剪辑')
    const opened = await second.evaluate((id) => window.henjiNative.documents.readDocument({ id }), copiedEdit.id)
    assert.equal(opened.missingPaths.length, 0, `拷来的项目不应缺素材：${opened.missingPaths.join('、')}`)
    for (const item of opened.content.media) assert.ok(inside(copyFolder, item.path), `拷来的项目里素材应解析到拷贝的文件夹：${item.path}`)
    await second.waitForFunction(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame !== undefined, null, { timeout: 30000 })
    await shot('paper-copied-project-opened')
    await button(second, '关闭项目').click()
    await button(second, '新建项目').waitFor({ state: 'visible', timeout: 15000 })
    currentRun.copied = { projectId: copied.id, folder: copyFolder, media: opened.content.media.map((item) => item.path) }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第二次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    evidence.passed = true
    save()
    console.log(`✓ 剪辑文档接入真实验收通过，证据：${evidenceFile}`)
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

module.exports = { runVideoEditDocumentsRestart }
