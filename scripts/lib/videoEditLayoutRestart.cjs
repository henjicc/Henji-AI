const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { videoEditFixtureProject } = require('./uiInspectionSceneVideoEditProbe.cjs')
const { setInspectionWindowSize } = require('./uiInspection.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')
const { createRuntimeEvidenceCollector, queryApplicationLogs } = require('./runtimeEvidence.cjs')
const { adoptNewVideoEditProject, leaveVideoEditProject, openVideoEditFile, readVideoEditFile } = require('./uiInspectionVideoEditDocuments.cjs')

const STORAGE_KEY = 'henji.videoEdit.dockLayout.v1'
const WINDOW_SIZE = { width: 1440, height: 900 }
const button = (page, name) => page.getByRole('button', { name, exact: true })
const group = (page, title) => page.locator('.dv-groupview').filter({ has: button(page, `关闭${title}`) })

/** Keep geometry and group membership; active tabs and floating positions must survive restart too. */
function layoutSnapshot(layout) {
  const groupData = value => ({ id: value.id, views: [...value.views], activeView: value.activeView ?? null })
  const node = value => ({ type: value.type, size: value.size ?? null,
    data: value.type === 'leaf' ? groupData(value.data) : value.data.map(node) })
  const grid = value => ({ width: value.width, height: value.height, orientation: value.orientation, root: node(value.root) })
  return { panels: Object.keys(layout.panels).sort(), grid: grid(layout.grid),
    floatingGroups: (layout.floatingGroups ?? []).map(value => ({
      position: value.position, ...(value.grid ? { grid: grid(value.grid) } : { data: groupData(value.data) }),
    })), activeGroup: layout.activeGroup ?? null }
}

function assertLayoutRestored(expected, actual) {
  const compare = (left, right, at) => {
    if (typeof left === 'number') {
      assert.ok(typeof right === 'number' && Number.isFinite(right) && Math.abs(left - right) <= 2,
        `布局尺寸或位置未恢复：${at}，期望 ${left}，实际 ${right}`)
    } else if (Array.isArray(left)) {
      assert.ok(Array.isArray(right), `布局结构未恢复：${at}`)
      assert.equal(right.length, left.length, `布局数量未恢复：${at}`)
      left.forEach((value, index) => compare(value, right[index], `${at}[${index}]`))
    } else if (left !== null && typeof left === 'object') {
      assert.ok(right !== null && typeof right === 'object', `布局结构未恢复：${at}`)
      assert.deepEqual(Object.keys(right).sort(), Object.keys(left).sort(), `布局字段未恢复：${at}`)
      for (const key of Object.keys(left)) compare(left[key], right[key], `${at}.${key}`)
    } else assert.equal(right, left, `布局内容未恢复：${at}`)
  }
  compare(layoutSnapshot(expected), layoutSnapshot(actual), 'layout')
}

async function limited(operation, milliseconds, label) {
  let timer
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}超时（${milliseconds}ms）`)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}

async function readLayout(page) {
  const raw = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)
  assert.ok(raw, '剪辑布局没有写入独立视图存储')
  return { raw, value: JSON.parse(raw) }
}

async function openProject(instance, file) {
  const { page, app } = instance
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, file)
  await button(page, '剪辑').click()
  await openVideoEditFile(page, file)
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas[aria-label="剪辑画面"]')
    return canvas?.dataset.presentedFrame === '0' && canvas.dataset.scrubbing === 'false'
  }, null, { timeout: 20000 })
}

async function renderState(page) {
  const value = await page.getByLabel('剪辑画面', { exact: true }).evaluate(canvas => ({
    width: canvas.width, height: canvas.height, presentedFrame: canvas.dataset.presentedFrame,
    renderMs: Number(canvas.dataset.renderMs), decodeMs: Number(canvas.dataset.decodeMs),
    gpuMs: Number(canvas.dataset.gpuMs), cacheHits: Number(canvas.dataset.cacheHits),
  }))
  assert.equal(value.width, 3840, '冷启动仍须使用完整 4K 画布')
  assert.equal(value.height, 2160, '冷启动仍须使用完整 4K 画布')
  assert.equal(value.presentedFrame, '0', '必须收到真实首帧呈现')
  assert.equal(await page.getByLabel('剪辑画面', { exact: true }).count(), 1, '只能挂载一份节目画面')
  return value
}

async function floatingProjectState(page) {
  const project = group(page, '素材')
  assert.equal(await project.count(), 1, '浮动素材面板只能有一份实际视图')
  await project.getByRole('button', { name: '面板菜单', exact: true }).click()
  assert.equal(await button(page, '贴回面板').isVisible(), true, '实际面板必须处于浮动位置')
  await project.getByRole('button', { name: '面板菜单', exact: true }).click()
  await page.waitForTimeout(250)
  const bounds = await project.boundingBox()
  assert.ok(bounds && bounds.width > 0 && bounds.height > 0, '浮动视图必须有实际可见尺寸')
  return bounds
}

async function capture(instance, file, result) {
  const bytes = await limited(() => captureInspectionPage(instance.app, instance.page, {
    onEvidence: value => { result.capture = value },
  }), 10000, 'Electron 原生截图')
  fs.writeFileSync(file, bytes)
  result.screenshot = file
}

async function finishRuntime(collector, instance, startedAt) {
  const runtime = await limited(() => collector.finish(), 10000, '正式应用日志查询')
  // Collector attaches once the official launcher returns; query startup errors from before launch too.
  const startup = await limited(() => queryApplicationLogs(instance.page, {
    afterTimestamp: startedAt, endTimestamp: runtime.finishedAt, level: 'error',
  }), 10000, '完整启动日志查询')
  runtime.startupLogErrors = startup.events
  runtime.startupLogQuery = { truncated: startup.truncated, corruptedLines: startup.corruptedLines }
  runtime.passed = runtime.passed && !startup.events.length && !startup.truncated && !startup.corruptedLines
  return runtime
}

/** Uses the existing restart runner's launcher; never owns a parallel Electron launch chain. */
async function runVideoEditLayoutRestart({ launch, userDataDir, outDir }) {
  const file = path.join(outDir, 'video-edit-layout.henji-video')
  const evidenceFile = path.join(outDir, 'video-edit-layout-restart.json')
  const fixture = videoEditFixtureProject({ id: 'reality-video-layout-restart', name: '剪辑冷启动布局验收', revision: 0,
    width: 3840, height: 2160, fps: 60, media: [], annotations: [],
    clips: [{ id: 'restart-title', name: '重启验收文字', kind: 'text', track: 1, start: 0, duration: 360,
      sourceInUs: 0, x: 0, y: 0, scale: 0.8, rotation: 0, opacity: 1, volume: 0, brightness: 1,
      text: 'Henji · 4K60 冷启动布局恢复' }] })
  const originalJson = JSON.stringify(fixture)
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(file, originalJson)
  const evidence = { target: 'video-edit-layout', userDataDir, project: file, fixture: '真实 v2 文字工程；没有媒体解码或转码',
    renderSize: { width: 3840, height: 2160, fps: 60 }, passed: false, firstRun: {}, secondRun: {} }
  const save = () => fs.writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2))
  // 3.1：剪辑存成项目里的文档；以第一次打开后的剪辑文件为基线核对“不改写”
  let openedJson = null
  const unchanged = () => assert.equal(JSON.stringify(readVideoEditFile(file)), openedJson, '布局修改或启动恢复不能改写工程 JSON')
  let current = null
  let collector = null
  let currentRun = evidence.firstRun
  const closeCurrent = async () => {
    if (!current) return
    const process = current.app.process()
    await limited(() => current.close(), 25000, '完整 Electron 退出')
    currentRun.exit = { pid: process.pid, exitCode: process.exitCode, signalCode: process.signalCode }
    assert.ok(process.exitCode !== null || process.signalCode !== null, '第一个 Electron 进程必须结束后才能启动第二个')
    current = null
  }
  try {
    currentRun.startedAt = new Date().toISOString()
    current = await launch(userDataDir)
    current.page.setDefaultTimeout(10000)
    currentRun.pid = current.app.process().pid
    collector = createRuntimeEvidenceCollector(current.page)
    collector.begin('video-edit-layout-restart-first')
    currentRun.window = await setInspectionWindowSize(current, WINDOW_SIZE)
    await limited(() => openProject(current, file), 30000, '第一次打开剪辑工程')
    openedJson = JSON.stringify(readVideoEditFile(file))
    currentRun.initialRender = await renderState(current.page)
    await button(current.page, '关闭效果控件').click()
    await group(current.page, '素材').getByRole('button', { name: '面板菜单', exact: true }).click()
    await button(current.page, '浮动面板').click()
    await current.page.waitForTimeout(450)
    const nonDefault = await readLayout(current.page)
    assert.deepEqual(Object.keys(nonDefault.value.panels).sort(), ['program', 'project', 'timeline'])
    assert.equal(nonDefault.value.floatingGroups.length, 1, '第一次启动须保存非默认浮动布局')
    assert.deepEqual(nonDefault.value.floatingGroups[0].data.views, ['project'])
    currentRun.floatingBounds = await floatingProjectState(current.page)
    currentRun.render = await renderState(current.page)
    assert.equal(await button(current.page, '撤销').isDisabled(), true, '布局操作不能进入剪辑历史')
    unchanged()
    await capture(current, path.join(outDir, 'video-edit-layout-first.png'), currentRun)
    // Dispose the workspace before process shutdown so its final debounced layout write is flushed.
    await button(current.page, '生成').click()
    await current.page.waitForTimeout(300)
    const saved = await readLayout(current.page)
    assertLayoutRestored(nonDefault.value, saved.value)
    currentRun.layout = saved.value
    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '第一次启动含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    save()

    currentRun = evidence.secondRun
    currentRun.startedAt = new Date().toISOString()
    current = await launch(userDataDir)
    current.page.setDefaultTimeout(10000)
    currentRun.pid = current.app.process().pid
    assert.notEqual(currentRun.pid, evidence.firstRun.pid, '必须是新的 Electron 主进程')
    collector = createRuntimeEvidenceCollector(current.page)
    collector.begin('video-edit-layout-restart-second')
    currentRun.window = await setInspectionWindowSize(current, WINDOW_SIZE)
    const persisted = await readLayout(current.page)
    assert.equal(persisted.raw, saved.raw, '完整退出后布局原始存储必须仍存在')
    currentRun.persistedLayout = persisted.value
    unchanged()
    await limited(() => openProject(current, file), 30000, '重启后打开同一剪辑工程')
    await current.page.waitForTimeout(450)
    const restored = await readLayout(current.page)
    assertLayoutRestored(saved.value, restored.value)
    assert.equal(await button(current.page, '关闭效果控件').count(), 0, '重启后效果面板仍须关闭')
    assert.equal(await group(current.page, '素材').count(), 1, '浮动面板只能恢复一份')
    assert.equal(await group(current.page, '节目画面').count(), 1)
    currentRun.floatingBounds = await floatingProjectState(current.page)
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(
      Math.abs(currentRun.floatingBounds[key] - evidence.firstRun.floatingBounds[key]) <= 2,
      `实际浮动面板 ${key} 未在冷启动后恢复`)
    currentRun.layout = restored.value
    currentRun.render = await renderState(current.page)
    assert.equal(await button(current.page, '撤销').isDisabled(), true)
    unchanged()
    await capture(current, path.join(outDir, 'video-edit-layout-second.png'), currentRun)
    currentRun.runtime = await finishRuntime(collector, current, currentRun.startedAt)
    assert.equal(currentRun.runtime.passed, true, '重启恢复含运行时错误，详见证据')
    collector.dispose(); collector = null
    save()
    await closeCurrent()
    unchanged()
    evidence.projectJsonUnchanged = true
    evidence.coldRestart = true
    evidence.passed = true
    save()
    console.log(`✓ 剪辑布局完整退出重启恢复通过，证据：${evidenceFile}`)
  } catch (error) {
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error)
    save() // Preserve the failing step before any potentially unavailable renderer cleanup.
    if (current) {
      await capture(current, path.join(outDir, 'video-edit-layout-failed.png'), currentRun)
        .catch(error => { evidence.failureCaptureError = error.message; save() })
    }
    throw error
  } finally {
    collector?.dispose()
    await closeCurrent().catch(error => { evidence.cleanupError = error.message; save(); throw error })
    save()
  }
  return evidence
}

module.exports = { assertLayoutRestored, layoutSnapshot, runVideoEditLayoutRestart }
