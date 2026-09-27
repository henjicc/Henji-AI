const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

// Load the installed patch, so CI also detects a missing postinstall application.
const patched = import(pathToFileURL(path.resolve(__dirname,
  '../../node_modules/@xyflow/react/dist/esm/henji-store-subscriptions.mjs')).href)

function sourceStore() {
  let state = { userSelectionActive: false, nodes: [], connection: {},
    connectionClickStartHandle: null, connectionMode: 'strict' }
  const initial = state
  const listeners = new Set()
  return {
    getState: () => state,
    getInitialState: () => initial,
    setState(partial) {
      const previous = state
      state = { ...state, ...partial }
      listeners.forEach(listener => listener(state, previous))
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    subscriberCount: () => listeners.size,
  }
}

test('selection batches view notifications while source state and action subscribers remain immediate', async () => {
  const { getSelectionViewStore } = await patched
  const source = sourceStore(), view = getSelectionViewStore(source)
  const raw = [], rendered = [], initial = source.getState()
  const unsubscribe = source.subscribe(state => raw.push(state))
  const stop = view.subscribe((state, before) => rendered.push({ state, before }))
  source.setState({ userSelectionActive: true })
  source.setState({ nodes: ['a'] })
  source.setState({ nodes: ['a', 'b'] })
  assert.equal(raw.length, 3)
  assert.deepEqual(view.getState().nodes, ['a', 'b'])
  assert.equal(view.getInitialState(), initial)
  assert.equal(rendered.length, 0)
  await Promise.resolve()
  assert.deepEqual(rendered, [{ state: source.getState(), before: initial }])
  stop(); unsubscribe()
  assert.equal(source.subscriberCount(), 0)
})

test('selection release synchronously publishes final state and cancels the pending notification', async () => {
  const { getSelectionViewStore } = await patched
  const source = sourceStore(), states = []
  const stop = getSelectionViewStore(source).subscribe(state => states.push(state))
  source.setState({ userSelectionActive: true, nodes: ['a'] })
  source.setState({ userSelectionActive: false })
  assert.equal(states.length, 1)
  assert.equal(states[0], source.getState())
  await Promise.resolve()
  assert.equal(states.length, 1)
  source.setState({ nodes: ['b'] })
  assert.equal(states.length, 2)
  assert.deepEqual(states[1].nodes, ['b'])
  stop()
})

test('selection unsubscribe removes the source listener and invalidates queued work before resubscription', async () => {
  const { getSelectionViewStore } = await patched
  const source = sourceStore(), view = getSelectionViewStore(source), seen = []
  const old = view.subscribe(() => assert.fail('unmounted subscriber called'))
  source.setState({ userSelectionActive: true, nodes: ['old'] })
  old(); old()
  assert.equal(source.subscriberCount(), 0)
  const stop = view.subscribe(state => seen.push(state.nodes))
  source.setState({ nodes: ['new'] })
  await Promise.resolve()
  assert.deepEqual(seen, [['new']])
  stop()
  assert.equal(source.subscriberCount(), 0)
})

test('selection supports consecutive batches and independent canvas lifetimes', async () => {
  const { getSelectionViewStore } = await patched
  const a = sourceStore(), b = sourceStore(), seenA = [], seenB = []
  const viewA = getSelectionViewStore(a), viewB = getSelectionViewStore(b)
  assert.equal(getSelectionViewStore(a), viewA)
  assert.notEqual(viewA, viewB)
  const stopA = viewA.subscribe(state => seenA.push(state.nodes))
  const stopB = viewB.subscribe(state => seenB.push(state.nodes))
  a.setState({ userSelectionActive: true, nodes: ['a'] })
  b.setState({ nodes: ['b'] })
  assert.deepEqual(seenB, [['b']])
  await Promise.resolve()
  a.setState({ nodes: ['c'] })
  await Promise.resolve()
  assert.deepEqual(seenA, [['a'], ['c']])
  stopA(); stopB()
})

test('Handles ignore unrelated changes but each connection field notifies synchronously', async () => {
  const { getHandleConnectionStore } = await patched
  const source = sourceStore(), view = getHandleConnectionStore(source), seen = []
  const stop = view.subscribe((state, previous) => seen.push({ state, previous }))
  source.setState({ nodes: ['a'], userSelectionActive: true })
  assert.equal(seen.length, 0)
  for (const change of [{ connection: { inProgress: true } },
    { connectionClickStartHandle: { nodeId: 'a' } }, { connectionMode: 'loose' },
    { connection: { inProgress: false }, connectionClickStartHandle: null }]) {
    const previous = source.getState(), length = seen.length
    source.setState(change)
    assert.equal(seen.length, length + 1)
    assert.deepEqual(seen.at(-1), { state: source.getState(), previous })
  }
  stop()
  assert.equal(source.subscriberCount(), 0)
})

test('both views share one source subscription per kind, release it, and reattach to current state', async () => {
  const { getSelectionViewStore, getHandleConnectionStore } = await patched
  for (const factory of [getSelectionViewStore, getHandleConnectionStore]) {
    const source = sourceStore(), view = factory(source), calls = []
    const listener = state => calls.push(state)
    const first = view.subscribe(listener), second = view.subscribe(listener)
    assert.equal(source.subscriberCount(), 1)
    first(); first()
    assert.equal(source.subscriberCount(), 1)
    source.setState({ connectionMode: 'loose' })
    assert.equal(calls.length, 1)
    second()
    assert.equal(source.subscriberCount(), 0)
    source.setState({ connectionMode: 'strict' })
    assert.equal(view.getState(), source.getState())
    const third = view.subscribe(listener)
    source.setState({ connectionMode: 'loose' })
    assert.equal(calls.length, 2)
    third()
    assert.equal(source.subscriberCount(), 0)
  }
})
