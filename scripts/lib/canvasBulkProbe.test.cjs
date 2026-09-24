const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createCanvasBulkProbe } = require('./canvasBulkProbe.cjs')

const plain = value => JSON.parse(JSON.stringify(value))
async function harness(t, expected, html = '<div class="react-flow__node" data-id="a"></div>') {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM(`<main class="react-flow">${html}</main><aside></aside>`, { runScripts: 'outside-only' })
  const win = dom.window, flow = win.document.querySelector('main')
  const frames = new Map(), timers = new Map(), handlers = new Map(), mutations = [], performances = []
  let clock = 0, id = 0
  win.performance.now = () => clock
  win.requestAnimationFrame = callback => { frames.set(++id, callback); return id }
  win.cancelAnimationFrame = value => frames.delete(value)
  win.setTimeout = callback => { timers.set(++id, callback); return id }
  win.clearTimeout = value => timers.delete(value)
  const MutationObserver = win.MutationObserver
  win.MutationObserver = class {
    constructor(callback) { this.inner = new MutationObserver(callback); this.connected = false; mutations.push(this) }
    observe(...args) { this.connected = true; this.inner.observe(...args) }
    takeRecords() { return this.inner.takeRecords() }
    disconnect() { this.connected = false; this.inner.disconnect() }
  }
  win.PerformanceObserver = class {
    constructor() { this.connected = false; performances.push(this) }
    observe() { this.connected = true }
    takeRecords() { return [] }
    disconnect() { this.connected = false }
  }
  const add = win.document.addEventListener.bind(win.document), remove = win.document.removeEventListener.bind(win.document)
  win.document.addEventListener = (type, callback, options) => { handlers.set(type, callback); add(type, callback, options) }
  win.document.removeEventListener = (type, callback, options) => { handlers.delete(type); remove(type, callback, options) }
  const probe = win.eval(`(${createCanvasBulkProbe.toString()})`)({ expected })
  t.after(() => { probe.dispose(); win.close() })
  return { win, flow, probe, frames, timers, mutations, performances, handlers,
    fire(type, extra = {}) { handlers.get(type)?.({ type, isTrusted: true, ...extra }) },
    advance(ms = 16) { clock += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(clock)) },
    addAuditCost(ms) { clock += ms },
  }
}

test('incremental snapshots follow selection, identifiers, and node/edge class changes', async t => {
  const h = await harness(t, { nodes: 1, edges: 0, selected: ['a'] })
  const node = h.flow.firstElementChild
  node.classList.add('selected')
  assert.deepEqual(plain(h.probe.readSnapshot()), { nodes: 1, edges: 0, selected: ['a'] })
  node.dataset.id = 'renamed'
  assert.deepEqual(plain(h.probe.readSnapshot()).selected, ['renamed'])
  node.className = 'react-flow__edge selected'
  assert.deepEqual(plain(h.probe.readSnapshot()), { nodes: 0, edges: 1, selected: [] })
  node.className = 'unrelated'
  assert.deepEqual(plain(h.probe.readSnapshot()), { nodes: 0, edges: 0, selected: [] })
  assert.equal(h.probe.auditSnapshot().matched, true)
})

test('subtree insertion, removal and reparenting count each final element once', async t => {
  const h = await harness(t, { nodes: 1, edges: 0, selected: [] })
  const group = h.win.document.createElement('section')
  group.innerHTML = '<div class="react-flow__node selected" data-id="b"></div><svg><g class="react-flow__edge"></g></svg>'
  h.flow.append(group)
  h.flow.prepend(group)
  assert.deepEqual(plain(h.probe.readSnapshot()), { nodes: 2, edges: 1, selected: ['b'] })
  group.remove()
  h.win.document.querySelector('aside').append(group)
  assert.deepEqual(plain(h.probe.readSnapshot()), { nodes: 1, edges: 0, selected: [] })
  h.flow.replaceChildren(group)
  assert.deepEqual(plain(h.probe.readSnapshot()), { nodes: 1, edges: 1, selected: ['b'] })
  group.firstElementChild.className = 'removed-class'
  group.remove()
  assert.deepEqual(plain(h.probe.readSnapshot()), { nodes: 0, edges: 0, selected: [] })
  assert.equal(h.probe.auditSnapshot().matched, true)
})

test('repeated reads and unrelated style changes do not rescan the full canvas', async t => {
  const h = await harness(t, { nodes: 1000, edges: 0 }, Array.from({ length: 1000 }, (_, i) => `<div class="react-flow__node" data-id="${i}"><span></span></div>`).join(''))
  const query = h.flow.querySelectorAll.bind(h.flow)
  let scans = 0
  h.flow.querySelectorAll = (...args) => { scans++; return query(...args) }
  for (let i = 0; i < 20; i++) {
    h.flow.firstElementChild.style.transform = `translate(${i}px)`
    h.flow.firstElementChild.firstElementChild.className = `unrelated-${i}`
    assert.equal(h.probe.readSnapshot().nodes, 1000)
  }
  assert.equal(scans, 0)
  assert.equal(h.probe.auditSnapshot().matched, true)
  assert.equal(scans, 2)
})

test('timing starts only on matching trusted input and excludes the independent final audit', async t => {
  const h = await harness(t, { nodes: 1, edges: 0, key: 'z' })
  h.fire('keydown', { key: 'z', isTrusted: false })
  h.fire('keydown', { key: 'x' })
  assert.equal(h.frames.size, 0)
  h.fire('keydown', { key: 'Z' })
  const query = h.flow.querySelectorAll.bind(h.flow)
  h.flow.querySelectorAll = (...args) => { h.addAuditCost(100); return query(...args) }
  h.advance(); h.advance()
  assert.equal(h.probe.result, null)
  h.advance()
  const result = await h.probe.done
  assert.equal(result.ok, true)
  assert.equal(result.domAuditMatched, true)
  assert.equal(result.elapsedMs, 48)
  assert.equal(result.p95Ms, 16)
  assert.equal(h.frames.size + h.timers.size, 0)
  assert.equal(h.mutations[0].connected || h.performances[0].connected, false)
  assert.equal(h.handlers.has('keydown') || h.handlers.has('pointerup'), false)
})

test('pointer samples wait for release and restart stability counting after a mismatching frame', async t => {
  const h = await harness(t, { nodes: 1, edges: 0, pointer: true })
  h.fire('pointerdown')
  h.advance(); h.advance(); h.advance()
  assert.equal(h.probe.result, null)
  h.fire('pointerup')
  h.advance()
  const node = h.flow.firstElementChild
  node.remove(); h.advance()
  h.flow.append(node); h.advance(); h.advance()
  assert.equal(h.probe.result, null)
  h.advance()
  assert.equal((await h.probe.done).ok, true)
  assert.equal(h.probe.result.afterReleaseMs, 80)
})

test('a lost mutation cannot turn stale cached counts into a passing sample', async t => {
  const h = await harness(t, { nodes: 1, edges: 0, key: 'v' })
  h.mutations[0].disconnect()
  h.flow.append(h.flow.firstElementChild.cloneNode(true))
  h.fire('keydown', { key: 'v' })
  h.advance(); h.advance(); h.advance()
  const result = await h.probe.done
  assert.equal(result.ok, false)
  assert.equal(result.domAuditMatched, false)
  assert.equal(result.actual.nodes, 2)
  assert.equal(result.incrementalActual.nodes, 1)
})

test('a replaced canvas and a timeout fail, and explicit disposal clears pending work', async t => {
  const h = await harness(t, { nodes: 1, edges: 0, key: 'v' })
  h.flow.replaceWith(h.flow.cloneNode(true))
  assert.equal(h.probe.auditSnapshot().matched, false)
  h.timers.values().next().value()
  assert.equal((await h.probe.done).ok, false)
  assert.equal(h.frames.size + h.timers.size, 0)
  h.probe.dispose()
  assert.equal(h.mutations[0].connected || h.performances[0].connected, false)
})
