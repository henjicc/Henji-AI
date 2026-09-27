const assert = require('node:assert/strict')

// Isolated Reality only: substitute the supplier side of IPC, retaining the
// production resume, progress tracker, React state and result persistence paths.
async function holdGenerationResults(app, image, count) {
  return app.evaluateHandle(({ ipcMain }, { image, count }) => {
    if (!process.env.HENJI_ISOLATED_APP_DATA) throw new Error('后台生成取样只允许隔离资料目录')
    const waiting = new Map(), requests = []
    ipcMain.removeHandler('ai:continuePolling')
    ipcMain.handle('ai:continuePolling', async (_event, request) => {
      const index = Number(String(request.taskId).replace('__generation_background_', ''))
      if (request.modelId !== 'kie-z-image' || request.taskId !== `__generation_background_${index}`
        || !Number.isInteger(index) || index < 0 || index >= count || requests.includes(request.taskId)) {
        throw new Error('后台生成取样拒绝非夹具或重复请求')
      }
      requests.push(request.taskId)
      await new Promise(resolve => waiting.set(request.taskId, resolve))
      waiting.delete(request.taskId)
      return { ok: true, data: { status: 'completed', taskId: request.taskId, url: image, filePath: image } }
    })
    return { snapshot: () => ({ requests: [...requests], waiting: waiting.size }),
      release: () => { for (const resolve of waiting.values()) resolve() },
      dispose: () => { for (const resolve of waiting.values()) resolve(); ipcMain.removeHandler('ai:continuePolling') } }
  }, { image, count })
}

async function observeGenerationProgress(page, count) {
  return page.evaluateHandle(count => {
    const last = new Map(), updates = new Map()
    const observer = new MutationObserver(records => {
      for (const record of records) {
        const element = record.target
        if (!element.style.transform.startsWith('scaleX(')) continue
        const id = element.closest('[data-generation-task-id]')?.dataset.generationTaskId
        const index = Number(id?.replace('__generation_bench_', ''))
        if (!id || id !== `__generation_bench_${index}` || index < 0 || index >= count) continue
        if (last.get(id) === element.style.transform) continue
        last.set(id, element.style.transform)
        updates.set(id, (updates.get(id) ?? 0) + 1)
      }
    })
    observer.observe(document.querySelector('.app-scroll-container'), { subtree: true, attributes: true, attributeFilter: ['style'] })
    return { snapshot: () => ({ updates: Object.fromEntries(updates), last: Object.fromEntries(last) }),
      dispose: () => observer.disconnect() }
  }, count)
}

async function finishGenerationResults(page, fixture, progress, count, historyCount) {
  const before = await fixture.evaluate(state => state.snapshot())
  assert.equal(before.requests.length, count, '后台任务没有全部进入正式续查链路')
  assert.equal(before.waiting, count, '取样期间后台任务提前结束')
  const observed = await progress.evaluate(state => state.snapshot())
  assert.ok(Object.values(observed.updates).some(value => value >= 2), `未观察到真实进度更新：${JSON.stringify(observed)}`)
  const completion = await page.evaluateHandle(() => {
    const start = performance.now(), frames = [], longTasks = []
    let frame, previous = null
    const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)))
    observer.observe({ type: 'longtask' })
    const tick = time => {
      frames.push(previous === null ? Math.max(0, performance.now() - start) : time - previous)
      previous = time; frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const dispose = () => { cancelAnimationFrame(frame); observer.disconnect() }
    return { dispose, stop: () => {
      const ended = performance.now()
      if (previous !== null) frames.push(Math.max(0, ended - previous))
      longTasks.push(...observer.takeRecords().map(entry => entry.duration)); dispose()
      frames.sort((a, b) => a - b)
      return { elapsedMs: ended - start, frames: frames.length,
        p95Ms: frames[Math.ceil(frames.length * 0.95) - 1] ?? null, maxMs: frames.at(-1) ?? null, longTasks }
    } }
  })
  const started = performance.now()
  let completionFrames
  try {
    await fixture.evaluate(state => state.release())
    await page.waitForFunction(async count => {
      const rows = await window.henjiNative.db.select("SELECT id,status,file_path FROM history WHERE task_id GLOB '__generation_background_*'", [])
      return rows.length === count && Array.from({ length: count }, (_, i) => rows.find(row => row.id === `__generation_bench_${i}`))
        .every(row => row && ['success', 'completed'].includes(row.status) && row.file_path)
    }, count, { timeout: 15000, polling: 200 })
    await page.waitForFunction(() => {
      const image = document.querySelector('[data-generation-task-id="__generation_bench_0"] img')
      return image?.complete && image.naturalWidth > 0
    })
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    completionFrames = await completion.evaluate(state => state.stop())
  } finally { await completion.evaluate(state => state.dispose()); await completion.dispose() }
  const settleMs = performance.now() - started
  const rows = await page.evaluate(() => window.henjiNative.db.select(
    "SELECT id,status,file_path,task_id,prompt FROM history WHERE id GLOB '__generation_bench_*'", []))
  assert.equal(rows.length, historyCount)
  for (let i = 0; i < count; i++) {
    const row = rows.find(row => row.id === `__generation_bench_${i}`)
    assert.equal(row.task_id, `__generation_background_${i}`)
    assert.ok(row.prompt.startsWith(`性能样本 ${i}：`))
  }
  const after = await fixture.evaluate(state => state.snapshot())
  assert.equal(after.waiting, 0)
  return { activeTasks: count, boundary: 'controlled supplier response after IPC; production renderer progress and persistence',
    observed, settleMs, completionFrames, persisted: true }
}

async function verifyGenerationReload(page, fixture, count, historyCount, inspection) {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator(`[data-generation-task-id="__generation_bench_${historyCount - 1}"]`).waitFor()
  await page.evaluate(() => { document.querySelector('.app-scroll-container').scrollTop = 0 })
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-generation-task-id="__generation_bench_0"] img')
    return image?.complete && image.naturalWidth > 0
  })
  assert.equal((await fixture.evaluate(state => state.snapshot())).requests.length, count, '重载错误地再次恢复已完成任务')
  await inspection.capture(`background-completed-${count}`)
}

module.exports = { holdGenerationResults, observeGenerationProgress, finishGenerationResults, verifyGenerationReload }
