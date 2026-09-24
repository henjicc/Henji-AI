const { findPanePoint } = require('./canvasPanBench.cjs')

// 输入事件到目标 DOM 状态稳定两帧的时间；不是屏幕实际呈现时间。
// 通过正式鼠标/快捷键入口驱动，不直接写 ReactFlow 或业务 store。
async function measureBulkAction(page, name, expected, action) {
  const probe = await page.evaluateHandle(({ expected }) => {
    const state = { result: null, dispose: null, done: null }
    let resolve, start = null, releasedAt = null, previous = null, frame, timer, settled = 0
    const frames = [], longTasks = []
    const flow = document.querySelector('.react-flow')
    const nodes = flow.getElementsByClassName('react-flow__node')
    const edges = flow.getElementsByClassName('react-flow__edge')
    const selected = flow.getElementsByClassName('react-flow__node selected')
    const read = () => ({
      nodes: nodes.length,
      edges: edges.length,
      selected: expected.selected ? [...selected].map(node => node.dataset.id).sort() : undefined,
    })
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (start !== null && entry.startTime + entry.duration > start) longTasks.push(entry.duration)
    })
    observer.observe({ type: 'longtask' })
    state.done = new Promise(callback => { resolve = callback })
    const dispose = () => {
      cancelAnimationFrame(frame); clearTimeout(timer); observer.disconnect()
      document.removeEventListener('keydown', onInput, true)
      document.removeEventListener('pointerdown', onInput, true)
      document.removeEventListener('pointerup', onRelease, true)
    }
    const finish = (ok, actual) => {
      for (const entry of observer.takeRecords()) if (start !== null && entry.startTime + entry.duration > start) longTasks.push(entry.duration)
      const sorted = [...frames].sort((a, b) => a - b)
      state.result = { ok, elapsedMs: start === null ? null : performance.now() - start, actual,
        // 框选总时长包含自动化发送多段鼠标移动的时间，单独记录松手后的收敛耗时。
        afterReleaseMs: releasedAt === null ? null : performance.now() - releasedAt,
        frameCount: frames.length, p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
        maxMs: sorted.at(-1) ?? null, longTasksMs: longTasks }
      dispose(); resolve(state.result)
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
    document.addEventListener('keydown', onInput, true)
    document.addEventListener('pointerdown', onInput, true)
    document.addEventListener('pointerup', onRelease, true)
    timer = setTimeout(() => finish(false, read()), 30000)
    return state
  }, { expected })
  try {
    await action()
    const result = await probe.evaluate(state => state.done)
    if (!result.ok) throw new Error(`${name} 未达到目标状态：${JSON.stringify({ expected, result })}`)
    console.log('[canvas-bulk-performance]', JSON.stringify({ name, ...result }))
    return { name, ...result }
  } finally {
    await probe.evaluate(state => state.dispose())
    await probe.dispose()
  }
}

async function checkCanvasBulkPerformance(page, inspection, projectId) {
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  const start = await findPanePoint(page, { preferRatioX: 0.03, preferRatioY: 0.05 })
  const end = await findPanePoint(page, { preferRatioX: 0.76, preferRatioY: 0.76 })
  if (!start || !end) throw new Error('批量操作基准找不到框选起止空白位置')
  await page.mouse.click(start.x, start.y)
  const fixture = await page.evaluate(({ start, end }) => {
    const left = Math.min(start.x, end.x), right = Math.max(start.x, end.x)
    const top = Math.min(start.y, end.y), bottom = Math.max(start.y, end.y)
    const nodes = [...document.querySelectorAll('.react-flow__node')]
    const selected = nodes.filter(node => {
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.height > 0 && box.left < right && box.right > left && box.top < bottom && box.bottom > top
    }).map(node => node.dataset.id).sort()
    // 本基准沿用 scale-i 三节点连接结构，包含跨框选边界的连线。
    const ids = new Set(selected)
    let removedEdges = 0, internalEdges = 0
    for (let i = 0; i < nodes.length; i++) if (i % 3 > 0) {
      const source = ids.has(`scale-${i - 1}`), target = ids.has(`scale-${i}`)
      if (source || target) removedEdges++
      if (source && target) internalEdges++
    }
    return { nodes: nodes.length, edges: document.querySelectorAll('.react-flow__edge').length, selected, removedEdges, internalEdges }
  }, { start, end })
  if (fixture.selected.length < 6) throw new Error(`批量夹具只覆盖 ${fixture.selected.length} 个节点`)
  const samples = []
  const record = async (name, expected, action) => {
    const sample = await measureBulkAction(page, name, expected, action)
    samples.push(sample)
    return sample
  }
  await record('rectangle-select', { ...fixture, pointer: true }, async () => {
    await page.keyboard.down(modifier)
    try {
      await page.mouse.move(start.x, start.y)
      await page.mouse.down()
      await page.mouse.move(end.x, end.y, { steps: 20 })
    } finally { await page.mouse.up(); await page.keyboard.up(modifier) }
  })
  await inspection.capture(`bulk-selected-${fixture.nodes}`)
  await page.keyboard.press(`${modifier}+c`)
  const deleted = { nodes: fixture.nodes - fixture.selected.length, edges: fixture.edges - fixture.removedEdges }
  const original = { nodes: fixture.nodes, edges: fixture.edges }
  await record('delete', { ...deleted, key: 'delete' }, () => page.keyboard.press('Delete'))
  await record('undo-delete', { ...original, key: 'z' }, () => page.keyboard.press(`${modifier}+z`))
  await record('redo-delete', { ...deleted, key: 'z' }, () => page.keyboard.press(`${modifier}+Shift+z`))
  await record('restore-delete', { ...original, key: 'z' }, () => page.keyboard.press(`${modifier}+z`))
  // 系统剪贴板可能含用户图片，它在产品中会优先于内部节点剪贴板。
  // 只在本次粘贴期间隔离该外部输入，不读取或改写用户的系统剪贴板。
  const pasteIsolation = await page.evaluateHandle(() => {
    const listener = event => { event.preventDefault(); event.stopImmediatePropagation() }
    document.addEventListener('paste', listener, true)
    return () => document.removeEventListener('paste', listener, true)
  })
  try {
    await record('paste', { nodes: fixture.nodes + fixture.selected.length, edges: fixture.edges + fixture.internalEdges, key: 'v' },
      () => page.keyboard.press(`${modifier}+v`))
  } finally {
    await pasteIsolation.evaluate(dispose => dispose())
    await pasteIsolation.dispose()
  }
  await inspection.capture(`bulk-pasted-${fixture.nodes}`)
  // 测量之外读取正式保存结果，防止只凭 DOM 数量把丢失数据或连错线算作成功。
  const readSaved = () => page.evaluate(async ({ projectId, fixture }) => {
    const record = await window.henjiNative.storyboardProjects.getProjectRecord(projectId)
    const nodes = JSON.parse(record.nodesJson), edges = JSON.parse(record.edgesJson)
    if (nodes.length !== fixture.nodes + fixture.selected.length || edges.length !== fixture.edges + fixture.internalEdges) return false
    const byId = new Map(nodes.map(node => [node.id, node]))
    const edgeById = new Map(edges.map(edge => [edge.id, edge]))
    for (let i = 0; i < fixture.nodes; i++) {
      const node = byId.get(`scale-${i}`), kind = i % 3, group = Math.floor(i / 3)
      if (!node || node.type !== ['uploadNode', 'imageNode', 'exportImageNode'][kind]
        || node.position.x !== (group % 16) * 1100 + kind * 350 || node.position.y !== Math.floor(group / 16) * 520) throw new Error('批量操作改变了原节点身份或位置')
      if (kind > 0) {
        const edge = edgeById.get(`scale-edge-${i}`)
        if (edge?.source !== `scale-${i - 1}` || edge.target !== node.id) throw new Error('删除撤销或粘贴改变了原有连线')
      }
    }
    const sourceIds = new Set(fixture.selected)
    const sources = nodes.filter(node => sourceIds.has(node.id))
    const copies = nodes.filter(node => !node.id.startsWith('scale-'))
    const idMap = new Map(sources.map((node, index) => [node.id, copies[index]?.id]))
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i], copy = copies[i]
      if (!copy || source.type !== copy.type) throw new Error('批量副本类型不匹配')
      for (const key of ['prompt', 'modelId', 'params', 'aspectRatio', 'imageUrl', 'previewImageUrl']) {
        if (JSON.stringify(source.data[key]) !== JSON.stringify(copy.data[key])) throw new Error(`批量副本数据未保留：${key}`)
      }
    }
    for (const edge of edges) if (sourceIds.has(edge.source) && sourceIds.has(edge.target)) {
      if (!edges.some(copy => copy.source === idMap.get(edge.source) && copy.target === idMap.get(edge.target)
        && copy.sourceHandle === edge.sourceHandle && copy.targetHandle === edge.targetHandle)) throw new Error('批量副本内部连线未保留')
    }
    return { nodes: nodes.length, edges: edges.length, copied: copies.length, originalGraphPreserved: true, copyDataAndConnectionsPreserved: true }
  }, { projectId, fixture })
  let persisted = false
  const deadline = Date.now() + 15000
  do {
    persisted = await readSaved()
    if (persisted) break
    await page.waitForTimeout(100)
  } while (Date.now() < deadline)
  if (!persisted) throw new Error('批量操作后的工程未在期限内完成保存')
  return { timing: 'trusted input event to expected DOM state plus two RAF intervals; not physical presentation', start, end, fixture, samples, persisted }
}

module.exports = { checkCanvasBulkPerformance }
