const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')

/*
 * 3.3 口播接入文档底座的真实 Electron 验收，跑在 mcp-restart-check 的同一套隔离资料目录与两次完整启动上
 * （--only audio-edit-documents）：
 *
 * 第一次启动（石墨）：导入音频即建草稿（文件在“文档/痕迹AI/口播”，素材引用原文件）→ 只导入不编辑的草稿离开时直接删除
 *   → 再导入并编辑（参考逐字稿）→ 离开时“取消”留在编辑器、“保存”起名（同文件夹重名提示且不能保存）、换名后转正
 *   → 另一份草稿“不保存”走回收站 → 重新打开已保存的口播再编辑，离开时不询问、改动写进文件；
 *   文档里只有外部素材的绝对路径，没有程序目录或隔离资料目录的路径。
 * 第二次启动（纸白）：列表里还在（卡片显示“音频 · 时长”）→ 重新打开，界面与文件里的内容一致。
 *
 * 数据全部经界面与正式接口造，不写 SQL。打开文件对话框在主进程里换成固定返回测试音频；“移到回收站”换成
 * 移进隔离目录里的 recycle/，不往用户真实回收站里放测试文件。
 */

const WINDOW_SIZE = { width: 1440, height: 900 }
const SAMPLE_RATE = 16000
const SECONDS = 6

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

/** 主进程里把回收站换成记录替身、打开文件对话框固定返回测试音频（只影响这个隔离实例）。 */
async function stubShellAndDialog(app, recycleDir, mediaPath) {
  await app.evaluate(({ shell, dialog }, { recycle, media }) => {
    const nodeFs = process.mainModule.require('node:fs')
    const nodePath = process.mainModule.require('node:path')
    globalThis.__henjiRealityShell = { trashed: [], revealed: [] }
    shell.trashItem = async (target) => {
      nodeFs.mkdirSync(recycle, { recursive: true })
      nodeFs.renameSync(target, nodePath.join(recycle, `${Date.now()}-${nodePath.basename(target)}`))
      globalThis.__henjiRealityShell.trashed.push(target)
    }
    shell.showItemInFolder = (target) => { globalThis.__henjiRealityShell.revealed.push(target) }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [media] })
  }, { recycle: recycleDir, media: mediaPath })
}

/** 6 秒单声道 WAV：每 2 秒前 1.2 秒有声音，之后留停顿。 */
function writeFixtureWav(file) {
  const frames = SAMPLE_RATE * SECONDS
  const wav = Buffer.alloc(44 + frames * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(SAMPLE_RATE, 24); wav.writeUInt32LE(SAMPLE_RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
  for (let index = 0; index < frames; index += 1) {
    const second = index / SAMPLE_RATE
    const amplitude = second % 2 < 1.2 ? 6000 : 0
    wav.writeInt16LE(Math.round(Math.sin(second * 330 * Math.PI * 2) * amplitude), 44 + index * 2)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, wav)
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
const readEnvelope = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

async function listAudioDocuments(page) {
  return await page.evaluate(() => window.henjiNative.documents.listDocuments({
    kind: 'audio_edit', container: { kind: 'any' }, includeDrafts: true, includeMissing: true,
  }))
}

async function documentNamed(page, name) {
  const found = (await listAudioDocuments(page)).find((document) => document.name === name)
  assert.ok(found, `作品索引里找不到“${name}”`)
  return found
}

async function openAudioEditList(page) {
  await page.getByRole('button', { name: /^(工具|Tools)$/ }).filter({ visible: true }).first().click()
  for (const title of ['返回口播列表', '返回工具']) {
    const back = page.locator(`[aria-label="${title}"]:visible`).first()
    if (await back.count()) await back.click()
  }
  await page.getByRole('button', { name: /^口播剪辑/ }).filter({ visible: true }).first().click()
  await button(page, '新建口播').waitFor({ state: 'visible', timeout: 15000 })
  await page.waitForTimeout(500)
}

/** “新建口播”= 导入音频或视频（对话框已替换为测试音频），导入即建草稿并进入编辑器。 */
async function importDraft(page) {
  await button(page, '新建口播').click()
  await page.getByRole('slider', { name: '口播波形定位' }).waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForTimeout(300)
}

async function typeReferenceScript(page, text) {
  const area = page.getByPlaceholder('用于对齐内容，不替代真实识别文本')
  if (!(await area.isVisible().catch(() => false))) await page.getByText('参考逐字稿', { exact: true }).first().click()
  await area.waitFor({ state: 'visible', timeout: 5000 })
  await area.fill(text)
  await page.waitForTimeout(300)
}

async function clickBack(page) {
  await page.locator('[aria-label="返回口播列表"]:visible').first().click()
}

async function leavePrompt(page) {
  const prompt = page.getByRole('alertdialog')
  await prompt.waitFor({ state: 'visible', timeout: 8000 })
  return prompt
}

/** 复用 mcp-restart-check 的启动器与隔离资料目录，不另建 Electron 启动链。 */
async function runAudioEditDocumentsRestart({ launch, userDataDir, outDir }) {
  const evidenceFile = path.join(outDir, 'audio-edit-documents-restart.json')
  const documentsRoot = path.join(userDataDir, 'app-data', 'Documents')
  const recycleDir = path.join(userDataDir, 'recycle')
  // 外部素材放在隔离资料目录之外（模拟用户自己的录音），文档里应原样记录它的绝对路径
  const mediaPath = path.join(outDir, 'audio-edit-documents-media', '口播素材 & 测试.wav')
  writeFixtureWav(mediaPath)
  const evidence = { target: 'audio-edit-documents', userDataDir, documentsRoot, mediaPath, passed: false, firstRun: {}, secondRun: {} }
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
    await stubShellAndDialog(current.app, recycleDir, mediaPath)
    collector = createRuntimeEvidenceCollector(current.page)
  }
  const shot = async (name) => capture(current, path.join(outDir, `audio-edit-${name}.png`), currentRun)
  const noProgramPaths = (file) => {
    const text = fs.readFileSync(file, 'utf8')
    for (const forbidden of [userDataDir, userDataDir.replace(/\\/g, '/')]) {
      assert.equal(text.includes(JSON.stringify(forbidden).slice(1, -1)), false, `文档里不得出现程序目录或隔离资料目录的路径：${file}`)
    }
  }

  try {
    // ==================== 第一次启动：石墨 ====================
    await start(['--dev-theme-preset=graphite'])
    collector.begin('audio-edit-documents-first')
    const { page } = current
    // 同一个文件夹里先有一份“口播查重”，用来验证起名查重（经正式文档接口造，空内容）
    await page.evaluate(() => window.henjiNative.documents.createDocument({ kind: 'audio_edit', container: { kind: 'user' }, name: '口播查重' }))
    const workRoot = path.join(documentsRoot, '痕迹AI')
    assert.ok(fs.existsSync(workRoot), `首启没有在隔离的“文档”下建作品目录：${workRoot}`)
    const audioFolder = path.join(workRoot, '口播')

    await openAudioEditList(page)
    await shot('graphite-list-first')

    // 只导入、没编辑：离开时不询问，草稿直接删除
    const trashedAtStart = (await readShell(current.app)).trashed.length
    await importDraft(page)
    const emptyDraft = (await listAudioDocuments(page)).find((document) => document.draft)
    assert.ok(emptyDraft && path.dirname(emptyDraft.path) === audioFolder, `导入即建草稿，应直接写进“口播”文件夹：${JSON.stringify(emptyDraft)}`)
    assert.equal(readEnvelope(emptyDraft.path).content.source.sourcePath, mediaPath, '草稿应引用原文件（外部绝对路径）')
    await clickBack(page)
    await button(page, '新建口播').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByRole('alertdialog').count(), 0, '只导入没编辑的草稿离开时不应询问')
    assert.equal(fs.existsSync(emptyDraft.path), false, '只导入没编辑的草稿离开时应直接删除')
    assert.equal((await readShell(current.app)).trashed.length, trashedAtStart, '空草稿直接删除，不进回收站')
    assert.ok(fs.existsSync(mediaPath), '删除口播草稿不能动原素材')

    // 有内容的草稿：取消 → 留在编辑器
    await importDraft(page)
    const draftOne = (await listAudioDocuments(page)).find((document) => document.draft)
    assert.ok(draftOne, '应有一份新的口播草稿')
    await typeReferenceScript(page, '第一版参考稿')
    await waitUntil(() => readEnvelope(draftOne.path).content.referenceScript === '第一版参考稿', '草稿自动保存参考稿')
    await shot('graphite-editor-draft')
    await clickBack(page)
    let prompt = await leavePrompt(page)
    await shot('graphite-leave-prompt')
    await prompt.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('slider', { name: '口播波形定位' }).waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(fs.existsSync(draftOne.path), true, '取消后草稿文件必须还在')

    // 保存：起名查重（同一文件夹已有“口播查重”），换名后转正
    await clickBack(page)
    prompt = await leavePrompt(page)
    await prompt.getByRole('button', { name: '保存', exact: true }).click()
    const nameDialog = page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).last()
    const nameInput = nameDialog.getByRole('textbox').first()
    await nameInput.waitFor({ state: 'visible', timeout: 8000 })
    await nameInput.fill('口播查重')
    await nameDialog.getByText('这个位置已有同名文件，请换一个名称。').waitFor({ state: 'visible', timeout: 5000 })
    assert.equal(await nameDialog.getByRole('button', { name: '保存', exact: true }).isDisabled(), true, '重名时“保存”必须不可用')
    await shot('graphite-save-name-duplicate')
    await nameInput.fill('口播一号')
    await page.waitForFunction(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      return dialogs.some((dialog) => [...dialog.querySelectorAll('button')].some((item) => item.textContent?.trim() === '保存' && !item.disabled))
    }, null, { timeout: 5000 })
    await nameDialog.getByRole('button', { name: '保存', exact: true }).click()
    await button(page, '新建口播').waitFor({ state: 'visible', timeout: 15000 })
    const saved = await documentNamed(page, '口播一号')
    assert.equal(saved.draft, false, '保存后必须去掉草稿标记')
    assert.equal(saved.id, draftOne.id, '草稿转正不换 ID')
    assert.equal(saved.path, path.join(audioFolder, '口播一号.henji-audio'))
    await card(page, saved.id).waitFor({ state: 'visible', timeout: 15000 })
    let envelope = readEnvelope(saved.path)
    assert.equal(envelope.format, 'henji-document')
    assert.equal(envelope.kind, 'audio_edit')
    assert.equal(envelope.id, saved.id)
    assert.equal(envelope.draft, undefined, '文件头不应再有草稿标记')
    assert.equal(envelope.content.referenceScript, '第一版参考稿')
    assert.equal(envelope.content.source.sourcePath, mediaPath, '外部素材按绝对路径原样记录')
    assert.equal(envelope.content.source.durationFrames, SAMPLE_RATE * SECONDS)
    for (const key of ['id', 'name', 'revision', 'createdAt', 'updatedAt']) assert.equal(key in envelope.content, false, `内容里不应有外壳字段 ${key}`)
    noProgramPaths(saved.path)
    currentRun.saved = { id: saved.id, path: saved.path }

    // 不保存：移到回收站
    await importDraft(page)
    const draftTwo = (await listAudioDocuments(page)).find((document) => document.draft)
    await typeReferenceScript(page, '这份不要了')
    await clickBack(page)
    prompt = await leavePrompt(page)
    await prompt.getByRole('button', { name: '不保存', exact: true }).click()
    await button(page, '新建口播').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(fs.existsSync(draftTwo.path), false, '“不保存”后草稿文件应移到回收站')
    assert.ok((await readShell(current.app)).trashed.includes(draftTwo.path), '“不保存”必须走系统回收站')

    // 重新打开已保存的口播再编辑：离开时不询问，改动写进文件
    await card(page, saved.id).click()
    await page.getByRole('slider', { name: '口播波形定位' }).waitFor({ state: 'visible', timeout: 20000 })
    await typeReferenceScript(page, '第二次修改的参考稿')
    await clickBack(page)
    await button(page, '新建口播').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await page.getByRole('alertdialog').count(), 0, '已保存的口播离开时不询问')
    envelope = readEnvelope(saved.path)
    assert.equal(envelope.content.referenceScript, '第二次修改的参考稿', '离开前的修改应写进文件')
    noProgramPaths(saved.path)
    currentRun.drafts = { emptyDeleted: emptyDraft.path, savedId: saved.id, discarded: draftTwo.path }
    currentRun.savedContent = { referenceScript: envelope.content.referenceScript, revision: envelope.revision }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()

    // ==================== 第二次启动：纸白 ====================
    currentRun = evidence.secondRun
    await start(['--dev-theme-preset=paper'])
    collector.begin('audio-edit-documents-second')
    const second = current.page
    assert.notEqual(currentRun.pid, evidence.firstRun.pid, '必须是新的 Electron 主进程')
    await openAudioEditList(second)
    await card(second, saved.id).waitFor({ state: 'visible', timeout: 15000 })
    await card(second, saved.id).getByText(/音频 · 0:06/).waitFor({ state: 'visible', timeout: 5000 })
    assert.ok(fs.existsSync(saved.path), '重启后文件仍在“口播”文件夹')
    await shot('paper-list-after-restart')

    await card(second, saved.id).click()
    await second.getByRole('slider', { name: '口播波形定位' }).waitFor({ state: 'visible', timeout: 20000 })
    const area = second.getByPlaceholder('用于对齐内容，不替代真实识别文本')
    if (!(await area.isVisible().catch(() => false))) await second.getByText('参考逐字稿', { exact: true }).first().click()
    assert.equal(await area.inputValue(), '第二次修改的参考稿', '重新打开后界面内容应与文件一致')
    const reopened = readEnvelope(saved.path)
    assert.equal(reopened.content.referenceScript, '第二次修改的参考稿')
    assert.equal(reopened.content.source.sourcePath, mediaPath)
    await shot('paper-editor-reopened')
    await clickBack(second)
    await button(second, '新建口播').waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await second.getByRole('alertdialog').count(), 0, '没改动的已保存口播离开时不询问')
    await shot('paper-list-final')
    currentRun.reopened = { id: saved.id, referenceScript: reopened.content.referenceScript }

    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第二次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    evidence.passed = true
    save()
    console.log(`✓ 口播文档接入真实验收通过，证据：${evidenceFile}`)
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

module.exports = { runAudioEditDocumentsRestart }
