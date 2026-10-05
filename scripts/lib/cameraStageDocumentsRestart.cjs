const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')

/*
 * 3.2 镜头参考接入（工具接入文档底座的样板）的真实 Electron 验收，跑在 mcp-restart-check 的同一套
 * 隔离资料目录与两次完整启动上（--only camera-stage-documents）：
 *
 * 第一次启动（石墨）：首启建作品目录 → 新建镜头参考（草稿）→ 编辑 → 离开时“取消 / 保存（起名查重）/ 不保存”
 *   与空草稿直接删除 → 文件确实在“文档/痕迹AI/镜头参考”，内容是位置写法、不含程序目录路径。
 * 两次启动之间：在资源管理器的位置拷贝一份文档（模拟用户自己复制），等启动后台扫描 / 页面扫描识别。
 * 第二次启动（纸白）：列表里还在、拷贝出来的副本换了新 ID → 右键改名、移到新项目（项目 .henji 隐藏）、
 *   创建副本、在文件夹中显示、删除（移到回收站）→ 外部删掉的文档显示“文件不存在”并能从列表移除。
 *
 * 数据全部经界面与正式文档接口造，不写 SQL。“移到回收站”与“在文件夹中显示”在主进程里换成记录替身
 * （trashItem 改为移进隔离目录里的 recycle/），不往用户真实回收站里放测试文件，也不弹资源管理器窗口。
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

/** 主进程里把回收站与“在文件夹中显示”换成记录替身（只影响这个隔离实例）。 */
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

/** 在测试进程里轮询（page.waitForFunction 的异步谓词会把 Promise 当成真值，不能用）。 */
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

async function listStageDocuments(page) {
  return await page.evaluate(() => window.henjiNative.documents.listDocuments({
    kind: 'camera_stage', container: { kind: 'any' }, includeDrafts: true, includeMissing: true,
  }))
}

async function documentNamed(page, name) {
  const found = (await listStageDocuments(page)).find((document) => document.name === name)
  assert.ok(found, `作品索引里找不到“${name}”`)
  return found
}

async function openCameraStageList(page) {
  await page.getByRole('button', { name: /^(工具|Tools)$/ }).filter({ visible: true }).first().click()
  for (const title of ['返回镜头参考列表', '返回工具']) {
    const back = page.locator(`[aria-label="${title}"]:visible`).first()
    if (await back.count()) await back.click()
  }
  await page.getByRole('button', { name: /^3D 镜头参考/ }).filter({ visible: true }).first().click()
  await button(page, '新建镜头参考').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(500)
}

async function createDraftAndAddSphere(page, { edit = true } = {}) {
  await button(page, '新建镜头参考').click()
  await page.locator('[title="添加球体"]:visible').waitFor({ state: 'visible', timeout: 20000 })
  if (edit) await page.locator('[title="添加球体"]:visible').click()
  await page.waitForTimeout(400)
}

async function clickBack(page) {
  await page.locator('[aria-label="返回镜头参考列表"]:visible').first().click()
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

/** Windows 用系统 attrib 读隐藏属性（输出前 20 列是属性位，之后才是路径）；其他平台点开头即隐藏。 */
function isHidden(target) {
  if (process.platform !== 'win32') return path.basename(target).startsWith('.')
  return execFileSync('attrib', [target], { encoding: 'utf8' }).slice(0, 20).includes('H')
}

function readEnvelope(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** 复用 mcp-restart-check 的启动器与隔离资料目录，不另建 Electron 启动链。 */
async function runCameraStageDocumentsRestart({ launch, userDataDir, outDir }) {
  const evidenceFile = path.join(outDir, 'camera-stage-documents-restart.json')
  const documentsRoot = path.join(userDataDir, 'app-data', 'Documents')
  const recycleDir = path.join(userDataDir, 'recycle')
  const evidence = { target: 'camera-stage-documents', userDataDir, documentsRoot, passed: false, firstRun: {}, secondRun: {} }
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
  const shot = async (name) => capture(current, path.join(outDir, `camera-stage-${name}.png`), currentRun)

  try {
    // ==================== 第一次启动：石墨 ====================
    await start(['--dev-theme-preset=graphite'])
    collector.begin('camera-stage-documents-first')
    const { page } = current
    // 用同一个文件夹里已有的“镜头查重”验证起名查重（经正式文档接口造数据）
    await page.evaluate(() => window.henjiNative.documents.createDocument({ kind: 'camera_stage', container: { kind: 'user' }, name: '镜头查重' }))
    const workRoot = path.join(documentsRoot, '痕迹AI')
    assert.ok(fs.existsSync(workRoot), `首启没有在隔离的“文档”下建作品目录：${workRoot}`)
    currentRun.workRootEntries = fs.readdirSync(workRoot)
    for (const folder of ['项目', '生成结果', '上传素材']) {
      assert.ok(currentRun.workRootEntries.includes(folder), `作品目录缺少分类文件夹“${folder}”：${currentRun.workRootEntries.join('、')}`)
    }
    const stageFolder = path.join(workRoot, '镜头参考')

    await openCameraStageList(page)
    await shot('graphite-list-first')

    // 有内容的草稿：取消 → 留在编辑器
    await createDraftAndAddSphere(page)
    const draftOne = (await listStageDocuments(page)).find((document) => document.draft)
    assert.ok(draftOne && draftOne.path.startsWith(stageFolder), `新建的草稿应以草稿标记直接写进“镜头参考”文件夹：${JSON.stringify(draftOne)}`)
    await clickBack(page)
    let prompt = await leavePrompt(page)
    await shot('graphite-leave-prompt')
    await prompt.getByRole('button', { name: '取消', exact: true }).click()
    await page.locator('[title="添加球体"]:visible').waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(fs.existsSync(draftOne.path), true, '取消后草稿文件必须还在')

    // 保存：起名查重（同一文件夹已有“镜头查重”），换名后转正
    await clickBack(page)
    prompt = await leavePrompt(page)
    await prompt.getByRole('button', { name: '保存', exact: true }).click()
    const nameDialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last()
    const nameInput = nameDialog.getByRole('textbox').first()
    await nameInput.waitFor({ state: 'visible', timeout: 8000 })
    await nameInput.fill('镜头查重')
    await nameDialog.getByText('这个位置已有同名文件，请换一个名称。').waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(await nameDialog.getByRole('button', { name: '保存', exact: true }).isDisabled(), true, '重名时“保存”必须不可用')
    await shot('graphite-save-name-duplicate')
    await nameInput.fill('镜头一号')
    await page.waitForFunction(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      return dialogs.some((dialog) => [...dialog.querySelectorAll('button')].some((item) => item.textContent?.trim() === '保存' && !item.disabled))
    }, null, { timeout: 5000 })
    await nameDialog.getByRole('button', { name: '保存', exact: true }).click()
    await button(page, '新建镜头参考').waitFor({ state: 'visible', timeout: 15000 })
    const saved = await documentNamed(page, '镜头一号')
    assert.equal(saved.draft, false, '保存后必须去掉草稿标记')
    assert.equal(saved.id, draftOne.id, '草稿转正不换 ID')
    assert.equal(saved.path, path.join(stageFolder, '镜头一号.henji-stage'))
    await card(page, saved.id).waitFor({ state: 'visible', timeout: 15000 })
    const envelope = readEnvelope(saved.path)
    assert.equal(envelope.format, 'henji-document')
    assert.equal(envelope.kind, 'camera_stage')
    assert.equal(envelope.id, saved.id)
    assert.equal(envelope.draft, undefined, '文件头不应再有草稿标记')
    assert.ok(envelope.content.objects.length >= 2, '保存的场景应包含默认摄像机与新加的球体')
    assert.equal(JSON.stringify(envelope).includes(userDataDir.replace(/\\/g, '\\\\')), false, '文档里不得出现程序目录或隔离资料目录的绝对路径')
    currentRun.saved = { id: saved.id, path: saved.path, objects: envelope.content.objects.length }

    // 不保存：移到回收站
    await createDraftAndAddSphere(page)
    const draftTwo = (await listStageDocuments(page)).find((document) => document.draft)
    await clickBack(page)
    prompt = await leavePrompt(page)
    await prompt.getByRole('button', { name: '不保存', exact: true }).click()
    await button(page, '新建镜头参考').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(fs.existsSync(draftTwo.path), false, '“不保存”后草稿文件应移到回收站')
    assert.ok((await readShell(current.app)).trashed.includes(draftTwo.path), '“不保存”必须走系统回收站')

    // 空草稿：不询问，直接删除
    const trashedBefore = (await readShell(current.app)).trashed.length
    await createDraftAndAddSphere(page, { edit: false })
    const draftThree = (await listStageDocuments(page)).find((document) => document.draft)
    await clickBack(page)
    await button(page, '新建镜头参考').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByRole('alertdialog').count(), 0, '空草稿离开时不应询问')
    assert.equal(fs.existsSync(draftThree.path), false, '空草稿离开时应直接删除')
    // 自动名会复用刚丢弃的那份草稿的文件名，所以按回收站次数核对
    assert.equal((await readShell(current.app)).trashed.length, trashedBefore, '空草稿直接删除，不进回收站')
    currentRun.drafts = { cancelledThenSaved: draftOne.id, discarded: draftTwo.path, emptyDeleted: draftThree.path }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()

    // ==================== 两次启动之间：在资源管理器的位置拷贝一份 ====================
    const externalCopy = path.join(stageFolder, '镜头外部拷贝.henji-stage')
    fs.copyFileSync(saved.path, externalCopy)

    // ==================== 第二次启动：纸白 ====================
    currentRun = evidence.secondRun
    await start(['--dev-theme-preset=paper'])
    collector.begin('camera-stage-documents-second')
    const second = current.page
    assert.notEqual(currentRun.pid, evidence.firstRun.pid, '必须是新的 Electron 主进程')
    await openCameraStageList(second)
    await card(second, saved.id).waitFor({ state: 'visible', timeout: 15000 })
    const copied = await documentNamed(second, '镜头外部拷贝')
    assert.notEqual(copied.id, saved.id, '扫描到的拷贝必须换新 ID')
    assert.equal(readEnvelope(externalCopy).id, copied.id, '新 ID 应写回拷贝的文件头')
    await card(second, copied.id).waitFor({ state: 'visible', timeout: 15000 })
    await shot('paper-list-after-restart')

    // 改名
    await contextMenuAction(second, saved.id, '重命名')
    const renameInput = second.getByRole('dialog').getByRole('textbox').first()
    await renameInput.fill('镜头改名')
    await second.waitForTimeout(400)
    await second.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click()
    await waitUntil(async () => (await listStageDocuments(second)).some((document) => document.id === saved.id && document.name === '镜头改名'), '改名完成')
    const renamedPath = path.join(stageFolder, '镜头改名.henji-stage')
    assert.ok(fs.existsSync(renamedPath) && !fs.existsSync(saved.path),
      `改名必须改文件名：${JSON.stringify({ files: fs.readdirSync(stageFolder), index: (await listStageDocuments(second)).map((item) => item.path) })}`)

    // 移到新项目
    await contextMenuAction(second, saved.id, '移到项目…')
    const moveDialog = second.getByRole('dialog').last()
    await moveDialog.getByText('新建项目', { exact: true }).click()
    await moveDialog.getByRole('textbox', { name: '新项目名称' }).fill('样板项目')
    await second.waitForTimeout(400)
    await shot('paper-move-to-project')
    await moveDialog.getByRole('button', { name: '移入', exact: true }).click()
    await waitUntil(async () => (await listStageDocuments(second)).some((document) => document.id === saved.id && document.projectName === '样板项目'), '移到项目完成')
    const projectFolder = path.join(workRoot, '项目', '样板项目')
    const movedPath = path.join(projectFolder, '镜头改名.henji-stage')
    assert.ok(fs.existsSync(movedPath), `移到项目后文件应在项目文件夹里：${movedPath}`)
    const projectInternal = path.join(projectFolder, '.henji')
    assert.ok(fs.existsSync(projectInternal), '项目文件夹里应有 .henji（项目说明）')
    assert.equal(isHidden(projectInternal), true, '项目里的 .henji 应设为隐藏')
    await second.waitForTimeout(300)
    assert.match(await card(second, saved.id).getAttribute('data-project-meta') ?? '', /样板项目/, '卡片应标出所属项目')

    // 创建副本
    await contextMenuAction(second, saved.id, '创建副本')
    await waitUntil(async () => (await listStageDocuments(second)).filter((document) => document.name.startsWith('镜头改名')).length === 2, '创建副本完成')
    const duplicate = (await listStageDocuments(second)).find((document) => document.name.startsWith('镜头改名') && document.id !== saved.id)
    assert.ok(duplicate && path.dirname(duplicate.path) === projectFolder, `副本应与原件在同一文件夹：${JSON.stringify(duplicate)}`)

    // 在文件夹中显示
    await contextMenuAction(second, saved.id, '在文件夹中显示')
    await second.waitForTimeout(300)
    assert.ok((await readShell(current.app)).revealed.includes(movedPath), '在文件夹中显示应定位到文档文件')

    // 删除（移到回收站）
    await contextMenuAction(second, copied.id, '删除')
    const confirm = second.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').filter({ hasText: '镜头外部拷贝' }).last()
    await confirm.waitFor({ state: 'visible', timeout: 5000 })
    await confirm.getByRole('button', { name: '移到回收站', exact: true }).click()
    await card(second, copied.id).waitFor({ state: 'detached', timeout: 10000 })
    assert.ok((await readShell(current.app)).trashed.includes(externalCopy), '删除必须走系统回收站')

    // 外部删掉的文件：显示“文件不存在”，从列表移除只改索引
    const duplicateCheck = await documentNamed(second, '镜头查重')
    fs.rmSync(duplicateCheck.path)
    await openCameraStageList(second)
    await second.locator(`[data-project-id="${duplicateCheck.id}"]:visible`).getByText('文件不存在').waitFor({ state: 'visible', timeout: 15000 })
    await contextMenuAction(second, duplicateCheck.id, '从列表移除')
    await card(second, duplicateCheck.id).waitFor({ state: 'detached', timeout: 10000 })
    await shot('paper-list-final')
    currentRun.operations = { renamedPath, movedPath, duplicate: duplicate.path, trashed: externalCopy, forgotten: duplicateCheck.id }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第二次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    evidence.passed = true
    save()
    console.log(`✓ 镜头参考文档接入真实验收通过，证据：${evidenceFile}`)
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

module.exports = { runCameraStageDocumentsRestart }
