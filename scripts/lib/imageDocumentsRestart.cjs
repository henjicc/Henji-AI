const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const yauzl = require('yauzl')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')

/*
 * 3.5 图片文档（.henjiimg 单文件包 + 程序目录工作副本 + 写回）的真实 Electron 验收，
 * 跑在 mcp-restart-check 的同一套隔离资料目录与两次完整启动上（--only image-documents）：
 *
 * 第一次启动（石墨）：工具 → 图片编辑（图片文档列表）→ 新建空白图片（草稿直接写进“图片文档/”）→
 *   改图层不透明度 → 命令带“保存”起名转正 → 再改一次 → 返回列表（关闭时写回，包头版本前进）→
 *   从列表重新打开，不透明度与写回的一致 → 再改一次，等工作副本自动保存（远短于 30 秒空闲写回）后
 *   直接结束 Electron 进程（模拟意外退出）：文件里仍是上一次写回的版本。
 * 第二次启动（纸白）：从列表打开 → 提示“恢复上次没写回的修改？”→ 恢复 → 不透明度是退出前的值 →
 *   返回列表写回 → 包头版本再前进；包里不含程序目录或隔离资料目录的路径。
 *
 * 数据全部经界面操作产生；回收站换成记录替身（同镜头参考验收），不往真实回收站放测试文件。
 */

const WINDOW_SIZE = { width: 1440, height: 900 }

function killTree(pid) {
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* 已经退出 */ }
  } else {
    try { process.kill(pid, 'SIGKILL') } catch { /* 已经退出 */ }
  }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
const HEADER_ENTRY = 'henji-document.json'
const MANIFEST_ENTRY = 'manifest.json'

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

async function waitUntil(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** 在测试进程里读 .henjiimg 的小条目（包头、清单），不经应用。 */
function readPackageEntries(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) { reject(error ?? new Error('无法打开图片文档包')); return }
      const entries = {}
      archive.on('entry', (entry) => {
        if (entry.fileName !== HEADER_ENTRY && entry.fileName !== MANIFEST_ENTRY) { archive.readEntry(); return }
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { reject(streamError ?? new Error('无法读取条目')); return }
          const chunks = []
          stream.on('data', (chunk) => chunks.push(chunk))
          stream.on('end', () => { entries[entry.fileName] = Buffer.concat(chunks).toString('utf8'); archive.readEntry() })
          stream.on('error', reject)
        })
      })
      archive.on('end', () => resolve(entries))
      archive.on('error', reject)
      archive.readEntry()
    })
  })
}

async function readHeader(file) {
  const entries = await readPackageEntries(file)
  assert.ok(entries[HEADER_ENTRY], `图片文档缺少包头：${file}`)
  return { header: JSON.parse(entries[HEADER_ENTRY]), manifest: entries[MANIFEST_ENTRY] ?? '', raw: Object.values(entries).join('\n') }
}

const button = (page, name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first()
const card = (page, id) => page.locator(`[data-project-id="${id}"]:visible`).first()

async function listImageDocuments(page) {
  return await page.evaluate(() => window.henjiNative.documents.listDocuments({
    kind: 'image_document', container: { kind: 'any' }, includeDrafts: true, includeMissing: true,
  }))
}

async function openImageList(page) {
  await page.getByRole('button', { name: /^(工具|Tools)$/ }).filter({ visible: true }).first().click()
  for (const title of ['返回图片文档列表', '返回工具']) {
    const back = page.locator(`[aria-label="${title}"]:visible`).first()
    if (await back.count()) await back.click()
    // 离开时如果弹出草稿提示，本场景不期望出现
    if (await page.getByRole('alertdialog').count()) throw new Error('打开列表时出现了意外的离开提示')
  }
  await page.getByRole('button', { name: /^图片编辑/ }).filter({ visible: true }).first().click()
  await listReady(page)
}

/** 列表页就绪：左栏有“新建图片文档”（点开选新建来源）。 */
async function listReady(page) {
  await page.locator('[aria-label="返回工具"]:visible, [title="返回工具"]:visible').first().waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(500)
}

/** 新建来源在左栏“新建图片文档”的菜单里（兼容旧版空态平铺按钮）。 */
async function chooseCreateSource(page, label) {
  const flat = button(page, label)
  if (await flat.count()) { await flat.click(); return }
  await button(page, '新建图片文档').click()
  await page.getByText(label, { exact: true }).filter({ visible: true }).first().click()
}

async function waitEditor(page) {
  await page.locator('[data-image-editor-v3]').first().waitFor({ state: 'visible', timeout: 30000 })
  await page.waitForTimeout(800)
}

async function opacitySlider(page) {
  const tab = page.getByRole('tab', { name: '基础', exact: true }).filter({ visible: true }).first()
  if (await tab.count()) await tab.click()
  const slider = page.getByRole('slider', { name: '不透明度' }).filter({ visible: true }).first()
  await slider.waitFor({ state: 'visible', timeout: 10000 })
  return slider
}

/** 用键盘改不透明度（与真实用户一致），返回改后的值。 */
async function nudgeOpacity(page, steps) {
  const slider = await opacitySlider(page)
  await slider.focus()
  for (let index = 0; index < steps; index += 1) await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Tab')
  await page.waitForTimeout(300)
  return await (await opacitySlider(page)).inputValue()
}

async function readOpacity(page) {
  return await (await opacitySlider(page)).inputValue()
}

async function backToList(page) {
  await page.locator('[aria-label="返回图片文档列表"]:visible').first().click()
}

/** 复用 mcp-restart-check 的启动器与隔离资料目录，不另建 Electron 启动链。 */
async function runImageDocumentsRestart({ launch, userDataDir, outDir }) {
  const evidenceFile = path.join(outDir, 'image-documents-restart.json')
  const documentsRoot = path.join(userDataDir, 'app-data', 'Documents')
  const recycleDir = path.join(userDataDir, 'recycle')
  const evidence = { target: 'image-documents', userDataDir, documentsRoot, passed: false, firstRun: {}, secondRun: {} }
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
  const shot = async (name) => capture(current, path.join(outDir, `image-documents-${name}.png`), currentRun)

  try {
    // ==================== 第一次启动：石墨 ====================
    await start(['--dev-theme-preset=graphite'])
    collector.begin('image-documents-first')
    const { page } = current
    const workRoot = path.join(documentsRoot, '痕迹AI')
    const imageFolder = path.join(workRoot, '图片文档')

    await openImageList(page)
    await shot('graphite-list-empty')

    // 新建空白图片：草稿直接写进“图片文档/”
    await chooseCreateSource(page, '新建空白图片')
    await button(page, '创建图片').click()
    await waitEditor(page)
    const draft = (await listImageDocuments(page)).find((document) => document.draft)
    assert.ok(draft && path.dirname(draft.path) === imageFolder, `新建的草稿应直接写进“图片文档”：${JSON.stringify(draft)}`)
    assert.equal((await readHeader(draft.path)).header.draft, true, '草稿包头应有草稿标记')

    // 编辑 → 命令带“保存”起名转正
    const firstOpacity = await nudgeOpacity(page, 5)
    await button(page, '保存').click()
    const nameDialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last()
    const nameInput = nameDialog.getByRole('textbox').first()
    await nameInput.waitFor({ state: 'visible', timeout: 8000 })
    await nameInput.fill('图片一号')
    await page.waitForTimeout(500)
    await shot('graphite-save-name')
    await nameDialog.getByRole('button', { name: '保存', exact: true }).click()
    const savedPath = path.join(imageFolder, '图片一号.henjiimg')
    await waitUntil(async () => fs.existsSync(savedPath), '保存后文件改名为“图片一号”')
    await waitUntil(async () => (await readHeader(savedPath)).header.revision >= 1, '保存时写回包')
    const afterSave = await readHeader(savedPath)
    assert.equal(afterSave.header.id, draft.id, '草稿转正不换 ID')
    assert.equal(afterSave.header.draft, undefined, '保存后包头不再有草稿标记')
    await shot('graphite-editor-saved')

    // 再改一次 → 返回列表：关闭时写回
    const secondOpacity = await nudgeOpacity(page, 5)
    assert.notEqual(secondOpacity, firstOpacity)
    await backToList(page)
    await listReady(page)
    assert.equal(await page.getByRole('alertdialog').count(), 0, '已保存的文档离开时不应询问')
    const afterClose = await readHeader(savedPath)
    assert.ok(afterClose.header.revision > afterSave.header.revision, '关闭时应写回 .henjiimg')
    await card(page, draft.id).waitFor({ state: 'visible', timeout: 15000 })
    await shot('graphite-list-after-close')

    // 重新打开：内容与写回的一致
    await card(page, draft.id).click()
    await waitEditor(page)
    assert.equal(await readOpacity(page), secondOpacity, '重新打开后不透明度应与写回的一致')

    // 再改一次，等工作副本自动保存后直接结束进程（模拟意外退出）
    const crashOpacity = await nudgeOpacity(page, 5)
    await page.waitForTimeout(3000)
    const beforeCrash = await readHeader(savedPath)
    assert.equal(beforeCrash.header.revision, afterClose.header.revision, '空闲 30 秒之前不应写回文件')
    currentRun.opacity = { first: firstOpacity, second: secondOpacity, crash: crashOpacity }
    currentRun.revisions = { save: afterSave.header.revision, close: afterClose.header.revision }
    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    // 启动器返回的子进程可能只是外层包装：取 Electron 主进程自己的 PID，连同子进程整棵树强制结束（不走任何退出流程）。
    const mainPid = await current.app.evaluate(() => process.pid)
    killTree(mainPid)
    await waitUntil(async () => !isAlive(mainPid), 'Electron 主进程已结束', 15000)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    currentRun.exit = { pid: mainPid, killed: true }
    current = null
    assert.equal((await readHeader(savedPath)).header.revision, afterClose.header.revision, '意外退出后文件仍是上一次写回的版本')

    // ==================== 第二次启动：纸白 ====================
    currentRun = evidence.secondRun
    await start(['--dev-theme-preset=paper'])
    collector.begin('image-documents-second')
    const second = current.page
    assert.notEqual(currentRun.pid, evidence.firstRun.pid, '必须是新的 Electron 主进程')
    await openImageList(second)
    await card(second, draft.id).waitFor({ state: 'visible', timeout: 15000 })
    await card(second, draft.id).click()
    const recovery = second.getByRole('alertdialog').filter({ hasText: '恢复上次没写回的修改？' })
    await recovery.waitFor({ state: 'visible', timeout: 15000 })
    await second.waitForTimeout(600) // 等弹窗入场动效结束再截图
    await shot('paper-recovery-prompt')
    await recovery.getByRole('button', { name: '恢复修改', exact: true }).click()
    await waitEditor(second)
    assert.equal(await readOpacity(second), crashOpacity, '恢复后应是意外退出前的修改')
    await backToList(second)
    await listReady(second)
    const afterRecovery = await readHeader(savedPath)
    assert.ok(afterRecovery.header.revision > afterClose.header.revision, '恢复后关闭应写回文件')
    for (const forbidden of [userDataDir, userDataDir.replace(/\\/g, '/'), 'ImageEditorV3', 'henji-media://']) {
      assert.equal(afterRecovery.raw.includes(forbidden), false, `包里不得出现“${forbidden}”`)
    }
    await shot('paper-list-final')
    currentRun.revisions = { recovered: afterRecovery.header.revision }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第二次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    evidence.passed = true
    save()
    console.log(`✓ 图片文档真实验收通过，证据：${evidenceFile}`)
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

module.exports = { runImageDocumentsRestart }
