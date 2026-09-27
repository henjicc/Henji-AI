const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createStore } = require('zustand/vanilla')
const { withCanvasStoreDiagnostic } = require('./canvasStoreDiagnostic.cjs')

test('诊断初始化失败时仍释放已获得的源句柄，不执行场景', async () => {
  const error = new Error('页面已关闭')
  let disposed = false
  const page = { evaluateHandle: async () => ({
    evaluateHandle: async () => { throw error },
    dispose: async () => { disposed = true },
  }) }
  await assert.rejects(withCanvasStoreDiagnostic(page, () => assert.fail('不得继续执行')), value => value === error)
  assert.equal(disposed, true)
})

for (const failure of [false, true]) {
  test(`状态诊断${failure ? '失败' : '成功'}后还原动作、释放订阅和句柄，保持实际状态`, async () => {
    const store = createStore(set => ({
      nodes: [], edges: [], userSelectionRect: null,
      setNodes: nodes => { set({ nodes }); return nodes.length },
      setEdges: edges => set({ edges }),
      triggerNodeChanges: () => {}, triggerEdgeChanges: () => {},
    }))
    const original = store.getState()
    const setState = store.setState
    const subscribe = store.subscribe
    let listeners = 0, sourceDisposed = false, probeDisposed = false
    store.subscribe = listener => {
      listeners++
      const stop = subscribe(listener)
      return () => { listeners--; stop() }
    }
    const page = { evaluateHandle: async () => ({
      evaluateHandle: async callback => {
        const probe = callback({ store })
        return { evaluate: async callback => callback(probe), dispose: async () => { probeDisposed = true } }
      },
      dispose: async () => { sourceDisposed = true },
    }) }
    const error = new Error('动作失败')
    const work = async () => {
      assert.equal(listeners, 1)
      store.setState({ userSelectionRect: { x: 20, y: 30 } })
      assert.equal(store.getState().setNodes(['a']), 1)
      store.getState().setEdges(['edge'])
      if (failure) throw error
      return { ok: true }
    }
    if (failure) await assert.rejects(withCanvasStoreDiagnostic(page, work), actual => actual === error)
    else {
      const result = await withCanvasStoreDiagnostic(page, work)
      assert.equal(result.ok, true)
      assert.deepEqual(result.diagnostic.publications, { userSelectionRect: 1, nodes: 1, edges: 1 })
      assert.equal(result.diagnostic.actions.setNodes.count, 1)
      assert.equal(result.diagnostic.actions.setEdges.count, 1)
    }
    for (const key of ['setNodes', 'setEdges', 'triggerNodeChanges', 'triggerEdgeChanges']) assert.equal(store.getState()[key], original[key])
    assert.equal(store.setState, setState)
    assert.deepEqual(store.getState().nodes, ['a'])
    assert.deepEqual(store.getState().edges, ['edge'])
    assert.equal(listeners, 0)
    assert.equal(sourceDisposed, true)
    assert.equal(probeDisposed, true)
  })
}
