'use strict'

// 仅供显式性能诊断；React 内部结构不是产品接口，不得用于业务运行。
function findCanvasStore() {
  const element = document.querySelector('.react-flow__node')
  let fiber = element?.[Object.keys(element).find(key => key.startsWith('__reactFiber$'))]
  let store, root = fiber
  while (fiber) {
    for (let dependency = fiber.dependencies?.firstContext; dependency; dependency = dependency.next) {
      const value = dependency.memoizedValue
      if (value?.getState?.().nodeLookup && value?.getState?.().transform) store = value
    }
    root = fiber
    fiber = fiber.return
  }
  if (!store) throw new Error('找不到 ReactFlow 诊断订阅源')
  return { store, root }
}

/** 记录各类发布次数与节点/边同步耗时；嵌套耗时不可相加，不用于性能验收。 */
async function withCanvasStoreDiagnostic(page, work) {
  const source = await page.evaluateHandle(findCanvasStore)
  let probe
  try {
    probe = await source.evaluateHandle(({ store }) => {
      const actions = {}, publications = {}
      const originalSetState = store.setState
      const originalActions = {}
      let active = true
      const record = (bucket, key, work) => {
        if (!active) return work()
        const start = performance.now()
        try { return work() }
        finally {
          const sample = bucket[key] ??= { count: 0, totalMs: 0, maxMs: 0 }
          const elapsed = performance.now() - start
          sample.count++; sample.totalMs += elapsed; sample.maxMs = Math.max(sample.maxMs, elapsed)
        }
      }
      const unsubscribe = store.subscribe((state, previous) => {
        if (!active) return
        const keys = Object.keys(state).filter(key => !Object.is(state[key], previous[key])).sort().join(',') || '(same fields)'
        publications[keys] = (publications[keys] ?? 0) + 1
      })
      for (const key of ['setNodes', 'setEdges', 'triggerNodeChanges', 'triggerEdgeChanges']) {
        const original = store.getState()[key]
        originalActions[key] = original
        originalSetState({ [key]: (...args) => record(actions, key, () => original(...args)) })
      }
      Object.keys(publications).forEach(key => delete publications[key])
      return {
        finish() {
          if (active) {
            active = false
            unsubscribe()
            originalSetState(originalActions)
          }
          return { actions, publications }
        },
      }
    })
    const result = await work()
    const diagnostic = await probe.evaluate(probe => probe.finish())
    return { ...result, diagnostic }
  } finally {
    try { if (probe) await probe.evaluate(probe => probe.finish()) }
    finally {
      try { await probe?.dispose() }
      finally { await source.dispose() }
    }
  }
}

module.exports = { findCanvasStore, withCanvasStoreDiagnostic }
