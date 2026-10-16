const { test } = require('node:test')
const assert = require('node:assert/strict')
const { analyzeFrameTrace, timingScopes } = require('./uiInspectionVideoEditFrameTrace.cjs')
const { statistics } = require('./uiInspectionSceneVideoEditCodePerformance.cjs')

test('跨线程同名同 id 的 trace 不串帧，零时长 scope 保留', () => {
  const event = (tid, ph, ts) => ({ name: 'henji.frame.evaluate:3', pid: 1, tid, id2: { local: 'x' }, ph, ts })
  const scopes = timingScopes([event(2, 'b', 1000), event(3, 'b', 2000), event(2, 'e', 4000), event(3, 'e', 6000), event(2, 'n', 7000)])
  assert.deepEqual(scopes.map(scope => scope.ms), [3, 4, 0])
})

test('逐帧归因区分完成后等待、Worker 与主线程 GC，不重复累加嵌套 GC', () => {
  const mark = (name, ts) => ({ name, ts, ph: 'I', pid: 1, tid: 1 })
  const scope = (name, start, end) => ['b', 'e'].map((ph, i) => ({ name: `henji.frame.${name}:3`, ph, ts: i ? end : start, pid: 1, tid: 2, id: name }))
  const events = [mark('henji.round.start:1', 0), mark('henji.round.end:1', 100000),
    { name: 'thread_name', pid: 1, tid: 1, args: { name: 'CrRendererMain' } },
    ...scope('worker.render', 2000, 30000), ...scope('evaluate', 3000, 13000),
    ...scope('draw.record', 13000, 15000), ...scope('draw.complete', 15000, 18000),
    ...scope('compositor.deadline', 18000, 21000).map(event => ({ ...event, name: 'henji.frame.compositor.deadline:-1' })),
    ...scope('compositor.inflight', 21000, 22000).map(event => ({ ...event, name: 'henji.frame.compositor.inflight:-1' })),
    { name: 'MinorGC', ph: 'X', pid: 1, tid: 2, ts: 5000, dur: 1000 },
    { name: 'V8.GC_SCAVENGER', ph: 'X', pid: 1, tid: 2, ts: 5000, dur: 1000 },
    { name: 'MajorGC', ph: 'X', pid: 1, tid: 1, ts: 8000, dur: 2000 }]
  const runs = [{ round: 1, evaluateDrawMs: { p50: 10 }, samples: [{ frame: 3, codePerformance: [{ cpuMs: 10, gpuMs: 40 }] }] }]
  const result = analyzeFrameTrace(events, runs)
  assert.equal(result.longFrameCount, 1)
  assert.equal(result.longFramesWithPostCompletionOver10Ms, 1)
  assert.equal(result.rows[0].afterDrawCompletionMs, 35)
  assert.equal(result.rows[0].workerGcMs, 1)
  assert.equal(result.rows[0].mainGcMs, 2)
  assert.equal(result.rows[0].compositorDeadlineWaitMs, 3)
  assert.equal(result.rows[0].compositorInflightWaitMs, 1)
  assert.equal(result.rows[0].mainPresentationNotificationMs, null)
  assert.equal(Object.values(result.longFrameTimeShare).reduce((a, b) => a + b, 0), 1)
  assert.throws(() => analyzeFrameTrace(events.filter(event => !event.name.includes('draw.complete')), runs), /完整/)
})

test('p99 与最长帧独立记录，不能只保留 p95', () => {
  const result = statistics(Array.from({ length: 200 }, (_, i) => i + 1))
  assert.deepEqual(result, { count: 200, p50: 101, p95: 191, p99: 199, max: 200 })
})
