const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createEditProbe } = require('./uiInspectionGenerationInputPerformance.cjs')
const { holdGenerationResults } = require('./uiInspectionGenerationBackground.cjs')
const vm = require('node:vm')

async function harness(t, editable = false) {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(`${editable ? '<div tabindex="0" contenteditable="true"></div>' : '<input>'}<p>old</p><article data-generation-task-id="stale"></article>`, { runScripts: 'outside-only' })
  const win = dom.window, input = win.document.body.firstElementChild, counter = win.document.querySelector('p')
  const frames = new Map(), timers = new Map()
  let clock = 0, id = 0, onEdit, connected = false
  win.performance.now = () => clock
  win.requestAnimationFrame = callback => { frames.set(++id, callback); return id }
  win.cancelAnimationFrame = key => frames.delete(key)
  win.setTimeout = callback => { timers.set(++id, callback); return id }
  win.clearTimeout = key => timers.delete(key)
  win.PerformanceObserver = class {
    observe() { connected = true }
    disconnect() { connected = false }
    takeRecords() { return [] }
  }
  input.addEventListener = (_type, callback) => { onEdit = callback }
  input.removeEventListener = () => { onEdit = null }
  input.focus()
  const probe = win.eval(`(${createEditProbe.toString()})`)({ input, counter, value: '9', label: '1 / 10', allowedIds: ['9'] })
  t.after(() => { probe.dispose(); win.close() })
  return { win, input, counter, probe, frames, timers,
    fire(trusted = true) { onEdit?.({ isTrusted: trusted }) },
    advance(timestamp) { clock += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(timestamp ?? clock)) },
    correct() { if (editable) input.textContent = '9'; else input.value = '9'; counter.textContent = '1 / 10'; win.document.querySelector('article').dataset.generationTaskId = '9' },
    clean() { assert.equal(frames.size, 0); assert.equal(timers.size, 0); assert.equal(connected, false); assert.equal(onEdit, null) },
  }
}

test('只从可信输入计时，结果数量和卡片身份必须同时更新并稳定', async t => {
  const h = await harness(t)
  h.fire(false); assert.equal(h.frames.size, 0)
  h.fire(); h.input.value = '9'; h.counter.textContent = '1 / 10'
  h.advance(); assert.equal(h.frames.size, 1)
  h.correct(); h.advance(); h.advance(); h.advance()
  const result = await h.probe.done
  assert.equal(result.ok, true); assert.equal(result.firstCorrectFrameMs, 32)
  h.clean()
})

test('富文本、焦点恢复与 RAF 时间基准不把负间隔记成一帧', async t => {
  const h = await harness(t, true)
  h.fire(); h.correct(); h.input.blur(); h.advance(-1)
  h.input.focus(); h.advance(15); h.advance(31); h.advance(47)
  const result = await h.probe.done
  assert.equal(result.ok, true); assert.equal(result.firstCorrectFrameMs, 32)
  assert.ok(result.frames.every(ms => ms >= 0)); h.clean()
})

test('结果未同步、重复卡片和超时不能误判为通过，退出解除所有采样资源', async t => {
  const h = await harness(t)
  h.fire(); h.correct()
  h.win.document.body.append(h.win.document.querySelector('article').cloneNode(true))
  h.advance(); h.advance(); h.advance()
  assert.equal(h.frames.size, 1)
  ;[...h.timers.values()][0]()
  assert.equal((await h.probe.done).ok, false); h.clean()
  const other = await harness(t)
  other.fire(); other.probe.dispose(); other.clean()
})

function backgroundHarness(isolated) {
  const handlers = new Map([['ai:continuePolling', () => { throw Error('不得调用真实供应商') }]])
  const original = handlers.get('ai:continuePolling')
  const ipcMain = { removeHandler: name => handlers.delete(name), handle: (name, callback) => handlers.set(name, callback) }
  const app = { evaluateHandle: async (fn, args) => vm.runInNewContext(`(${fn.toString()})`, {
    process: { env: isolated ? { HENJI_ISOLATED_APP_DATA: '/isolated-profile' } : {} },
  })({ ipcMain }, args) }
  return { app, handlers, original }
}

test('后台任务替身拒绝真实资料目录，在触碰 IPC 前失败', async () => {
  const h = backgroundHarness(false)
  await assert.rejects(holdGenerationResults(h.app, '/fixture.png', 2), /只允许隔离资料/)
  assert.equal(h.handlers.get('ai:continuePolling'), h.original)
})

test('后台任务只接受约定模型和任务，每个请求仅释放一次，退出解除挂起与处理器', async () => {
  const h = backgroundHarness(true)
  const fixture = await holdGenerationResults(h.app, '/fixture.png', 2)
  const request = h.handlers.get('ai:continuePolling')
  await assert.rejects(request({}, { modelId: 'other', taskId: '__generation_background_0' }))
  await assert.rejects(request({}, { modelId: 'kie-z-image', taskId: 'real-user-task' }))
  const first = request({}, { modelId: 'kie-z-image', taskId: '__generation_background_0' })
  await assert.rejects(request({}, { modelId: 'kie-z-image', taskId: '__generation_background_0' }))
  assert.equal(fixture.snapshot().waiting, 1)
  fixture.release()
  assert.equal((await first).data.filePath, '/fixture.png')
  assert.equal(fixture.snapshot().waiting, 0)
  const second = request({}, { modelId: 'kie-z-image', taskId: '__generation_background_1' })
  fixture.dispose()
  assert.equal((await second).data.status, 'completed')
  assert.equal(fixture.snapshot().waiting, 0)
  assert.equal(h.handlers.size, 0)
})
