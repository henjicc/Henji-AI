'use strict'

// Passed directly to page.evaluateHandle: keep browser dependencies inside this
// function. Full DOM scans happen before input and after timing, never every RAF.
function createCanvasBulkProbe({ expected }) {
  const flow = document.querySelector('.react-flow')
  if (!flow) throw new Error('批量操作取样找不到画布')
  const state = { result: null, dispose: null, done: null, readSnapshot: null, auditSnapshot: null }
  const nodes = new Set(), edges = new Set(), selected = new Set()
  const selector = '.react-flow__node, .react-flow__edge'
  const reconcile = element => {
    const attached = flow.contains(element)
    const node = attached && element.classList.contains('react-flow__node')
    const edge = attached && element.classList.contains('react-flow__edge')
    if (node) nodes.add(element); else nodes.delete(element)
    if (edge) edges.add(element); else edges.delete(element)
    if (node && element.classList.contains('selected')) selected.add(element); else selected.delete(element)
  }
  flow.querySelectorAll(selector).forEach(reconcile)
  const updateDom = records => {
    const changed = new Set()
    const collect = element => {
      if (element.nodeType !== 1) return
      changed.add(element)
      element.querySelectorAll(selector).forEach(child => changed.add(child))
    }
    for (const record of records) {
      if (record.type === 'attributes') changed.add(record.target)
      else {
        record.addedNodes.forEach(collect)
        record.removedNodes.forEach(collect)
      }
    }
    changed.forEach(reconcile)
  }
  const domObserver = new MutationObserver(updateDom)
  domObserver.observe(flow, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  const read = () => {
    updateDom(domObserver.takeRecords())
    return { nodes: nodes.size, edges: edges.size,
      selected: expected.selected ? [...selected].map(node => node.dataset.id).sort() : undefined }
  }
  // Independent oracle: count the final DOM again, including selected identities.
  // A missed mutation must fail the sample, even when cached counts match the goal.
  const audit = actual => {
    const final = { nodes: flow.querySelectorAll('.react-flow__node').length,
      edges: flow.querySelectorAll('.react-flow__edge').length,
      selected: expected.selected ? [...flow.querySelectorAll('.react-flow__node.selected')].map(node => node.dataset.id).sort() : undefined }
    return { actual: final, matched: flow.isConnected && document.querySelector('.react-flow') === flow
      && JSON.stringify(actual) === JSON.stringify(final) }
  }

  let resolve, start = null, releasedAt = null, previous = null, frame, timer, settled = 0, disposed = false
  const frames = [], longTasks = []
  const recordLongTasks = entries => {
    for (const entry of entries) if (start !== null && entry.startTime + entry.duration > start) longTasks.push(entry.duration)
  }
  const observer = new PerformanceObserver(list => recordLongTasks(list.getEntries()))
  observer.observe({ type: 'longtask' })
  state.done = new Promise(callback => { resolve = callback })
  const dispose = () => {
    disposed = true
    cancelAnimationFrame(frame); clearTimeout(timer)
    observer.disconnect(); domObserver.disconnect()
    document.removeEventListener('keydown', onInput, true)
    document.removeEventListener('pointerdown', onInput, true)
    document.removeEventListener('pointerup', onRelease, true)
  }
  const finish = (ok, actual) => {
    if (disposed) return
    const ended = performance.now()
    recordLongTasks(observer.takeRecords())
    const sorted = [...frames].sort((a, b) => a - b)
    dispose()
    const checked = audit(actual)
    state.result = { ok: ok && checked.matched, elapsedMs: start === null ? null : ended - start,
      actual: checked.actual, domAuditMatched: checked.matched,
      ...(!checked.matched ? { incrementalActual: actual } : {}),
      afterReleaseMs: releasedAt === null ? null : ended - releasedAt,
      frameCount: frames.length, p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
      maxMs: sorted.at(-1) ?? null, longTasksMs: longTasks }
    resolve(state.result)
  }
  const tick = now => {
    if (previous !== null) frames.push(now - previous)
    previous = now
    const actual = read()
    const matches = actual.nodes === expected.nodes && actual.edges === expected.edges
      && (!expected.selected || JSON.stringify(actual.selected) === JSON.stringify(expected.selected))
      && (!expected.pointer || releasedAt !== null)
    settled = matches ? settled + 1 : 0
    if (settled >= 3) finish(true, actual)
    else frame = requestAnimationFrame(tick)
  }
  function onInput(event) {
    if (start !== null || !event.isTrusted) return
    if (expected.pointer ? event.type !== 'pointerdown' : event.type !== 'keydown' || event.key.toLowerCase() !== expected.key) return
    start = performance.now(); previous = start; frame = requestAnimationFrame(tick)
  }
  function onRelease() { releasedAt = performance.now() }
  state.dispose = dispose
  state.readSnapshot = read
  state.auditSnapshot = () => audit(read())
  document.addEventListener('keydown', onInput, true)
  document.addEventListener('pointerdown', onInput, true)
  document.addEventListener('pointerup', onRelease, true)
  timer = setTimeout(() => finish(false, read()), 30000)
  return state
}

module.exports = { createCanvasBulkProbe }
