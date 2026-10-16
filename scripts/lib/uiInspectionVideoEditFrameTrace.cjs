const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

function timingScopes(events) {
  const starts = new Map(); const scopes = []
  for (const event of events) {
    if (!event.name.startsWith('henji.frame.')) continue
    const key = [event.pid, event.tid, event.name, event.id2?.local ?? event.id].join('/')
    if (event.ph === 'b') starts.set(key, event)
    if (event.ph === 'e') {
      const start = starts.get(key)
      if (start) scopes.push({ ...start, end: event.ts, ms: (event.ts - start.ts) / 1000 })
      starts.delete(key)
    }
    if (event.ph === 'n') scopes.push({ ...event, end: event.ts, ms: 0 })
  }
  return scopes
}

function analyzeFrameTrace(events, runs) {
  const scopes = timingScopes(events)
  // Top-level GC events only: summing nested V8.GC_* scopes would multiply pauses.
  const gc = events.filter(event => ['MinorGC', 'MajorGC'].includes(event.name) && event.ph === 'X')
  const marks = events.filter(event => event.name.startsWith('henji.') && event.ph === 'I')
  const mainThreads = new Set(events.filter(event => event.name === 'thread_name' && event.args.name === 'CrRendererMain').map(event => `${event.pid}:${event.tid}`))
  const overlap = (start, end, event) => Math.max(0, Math.min(end, event.ts + event.dur) - Math.max(start, event.ts)) / 1000
  const rows = []
  for (const run of runs) {
    const start = marks.find(event => event.name === `henji.round.start:${run.round}`)?.ts
    const end = marks.find(event => event.name === `henji.round.end:${run.round}`)?.ts
    assert.ok(Number.isFinite(start) && Number.isFinite(end), `缺少第 ${run.round} 轮 trace 边界`)
    const roundScopes = scopes.filter(event => event.ts >= start && event.end <= end)
    const roundMarks = marks.filter(event => event.ts >= start && event.ts <= end)
    for (const sample of run.samples) {
      const frame = sample.frame
      const render = roundScopes.find(event => event.name === `henji.frame.worker.render:${frame}`)
      assert.ok(render, `缺少第 ${run.round} 轮帧 ${frame} Worker trace`)
      const phases = roundScopes.filter(event => event.tid === render.tid && event.pid === render.pid)
      const phase = name => phases.find(event => event.name === `henji.frame.${name}:${frame}`)
      const evaluate = phase('evaluate'); const record = phase('draw.record'); const completion = phase('draw.complete')
      assert.ok(evaluate && record && completion, '取证需要完整的代码求值与绘制分段')
      const total = sample.codePerformance.reduce((sum, cost) => sum + cost.cpuMs + cost.gpuMs, 0)
      const costEnd = evaluate.ts + total * 1000
      const marker = name => roundMarks.find(event => event.pid === render.pid && event.name === `henji.main.${name}:${frame}`)?.ts
      const request = marker('request'); const received = marker('received'); const presented = marker('presented')
      const queue = phase('worker.queue'); const post = phase('worker.post')
      const nestedMs = name => {
        const nested = phases.filter(event => event.name === `henji.frame.${name}:-1` && event.ts >= render.ts && event.end <= render.end)
        return nested.length ? nested.reduce((sum, event) => sum + event.ms, 0) : null
      }
      rows.push({ round: run.round, frame, long: total > 2 * run.evaluateDrawMs.p50, totalMs: total,
        evaluateMs: evaluate.ms, drawRecordMs: record.ms, drawCompletionWaitMs: completion.ms,
        afterDrawCompletionMs: total - evaluate.ms - record.ms - completion.ms,
        workerQueueMs: queue?.ms ?? null, mainToWorkerMs: request === undefined || !queue ? null : (queue.ts - request) / 1000,
        compositorRecordAndDeadlineWaitMs: phase('compositor.record')?.ms ?? null,
        compositorDeadlineWaitMs: nestedMs('compositor.deadline'),
        compositorInflightWaitMs: nestedMs('compositor.inflight'),
        compositorCompletionMs: phase('compositor.complete')?.ms ?? null,
        bitmapPreparationMs: phase('bitmap.prepare')?.ms ?? null,
        returnToMainMs: received === undefined || !post ? null : (received - post.end) / 1000,
        mainPresentationNotificationMs: presented === undefined || received === undefined ? null : (presented - received) / 1000,
        workerGcMs: gc.filter(event => event.pid === render.pid && event.tid === render.tid).reduce((sum, event) => sum + overlap(evaluate.ts, costEnd, event), 0),
        mainGcMs: gc.filter(event => event.pid === render.pid && mainThreads.has(`${event.pid}:${event.tid}`)).reduce((sum, event) => sum + overlap(evaluate.ts, costEnd, event), 0),
        cacheCleanupMs: phases.filter(event => event.name === 'henji.frame.cache.cleanup:-1' && event.ts >= render.ts && event.end <= render.end).reduce((sum, event) => sum + event.ms, 0),
        cacheEvictions: phases.filter(event => event.name === 'henji.frame.cache.evict:-1' && event.ts >= render.ts && event.ts <= render.end).length,
        trace: { pid: render.pid, tid: render.tid, startUs: evaluate.ts, endUs: costEnd },
      })
    }
  }
  const hot = rows.filter(row => row.round > 0); const long = hot.filter(row => row.long)
  const sum = key => long.reduce((sum, row) => sum + row[key], 0)
  return { semantics: { long: 'evaluate+draw > 2 × per-round median; content complexity also changes within the clip',
    completion: 'CPU observation of GPU queue completion, including callback scheduling; not GPU timestamp-query duration',
    presentation: 'Worker directly composites the transferred canvas; main notification is not physical display scanout',
    gc: 'overlap is correlation, not proof of causation; renderer and Worker counted separately' },
    sampleCount: rows.length, hotSampleCount: hot.length, longFrameCount: long.length,
    longFramesWithWorkerGc: long.filter(row => row.workerGcMs > 0).length,
    longFramesWithMainGc: long.filter(row => row.mainGcMs > 0).length,
    longFramesWithPostCompletionOver10Ms: long.filter(row => row.afterDrawCompletionMs > 10).length,
    longFrameTimeShare: Object.fromEntries(['evaluateMs', 'drawRecordMs', 'drawCompletionWaitMs', 'afterDrawCompletionMs'].map(key => [key, sum(key) / sum('totalMs')])),
    rows }
}

if (require.main === module) {
  const root = path.resolve(process.argv[2])
  const evidence = JSON.parse(fs.readFileSync(path.join(root, 'evidence.json'), 'utf8'))
  const trace = JSON.parse(fs.readFileSync(evidence.tracePath, 'utf8'))
  const result = analyzeFrameTrace(trace.traceEvents, evidence.runs)
  fs.writeFileSync(path.join(root, 'frame-attribution.json'), JSON.stringify(result, null, 2))
  process.stdout.write(`${JSON.stringify({ ...result, rows: undefined }, null, 2)}\n`)
}
module.exports = { analyzeFrameTrace, timingScopes }
