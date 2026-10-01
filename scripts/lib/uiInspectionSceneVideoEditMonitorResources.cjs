const assert = require('node:assert/strict')

/** Observe the formal main-process wave worker and ffmpeg; never substitute their work. */
async function observeNativeWaveforms(app) {
  await app.evaluate(() => {
    const threads = process.getBuiltinModule('node:worker_threads')
    const processes = process.getBuiltinModule('node:child_process')
    const state = { workers: [], processes: [], peakWorkers: 0, peakProcesses: 0 }
    const NativeWorker = threads.Worker
    const nativeSpawn = processes.spawn
    globalThis.__videoMonitorNativeWaveforms = { state, threads, processes, NativeWorker, nativeSpawn }
    threads.Worker = new Proxy(NativeWorker, {
      construct(target, args, newTarget) {
        const worker = Reflect.construct(target, args, newTarget)
        if (args[1]?.name !== 'henji-audio-waveform') return worker
        const record = { id: state.workers.length + 1, createdAt: performance.now(), ended: false, options: null, channels: null }
        state.workers.push(record)
        state.peakWorkers = Math.max(state.peakWorkers, state.workers.filter(value => !value.ended).length)
        const post = worker.postMessage
        worker.postMessage = function (...messages) {
          if (messages[0]?.type === 'start') record.options = { ...messages[0].options }
          return Reflect.apply(post, this, messages)
        }
        worker.on('message', message => {
          if (Array.isArray(message?.channels)) record.channels = message.channels.map(channel => ({
            maxPeak: Math.max(0, ...channel.peak), maxRms: Math.max(0, ...channel.rms),
            sampleCount: channel.sampleCounts.reduce((sum, value) => sum + value, 0), buckets: channel.peak.length,
          }))
        })
        worker.once('exit', code => { record.ended = true; record.endedAt = performance.now(); record.exitCode = code })
        return worker
      },
    })
    processes.spawn = new Proxy(nativeSpawn, {
      apply(target, receiver, args) {
        const child = Reflect.apply(target, receiver, args)
        const argv = args[1] ?? []
        const filter = argv[argv.indexOf('-af') + 1]
        if (!argv.includes('f32le') || typeof filter !== 'string' || !filter.includes('first_pts=')) return child
        const read = flag => argv[argv.indexOf(flag) + 1]
        const record = { id: state.processes.length + 1, createdAt: performance.now(), ended: false,
          source: read('-i'), sampleRate: Number(read('-ar')), channels: Number(read('-ac')),
          firstSample: Number(/first_pts=(\d+)/.exec(filter)?.[1]), sampleCount: Number(/end_sample=(\d+)/.exec(filter)?.[1]) }
        state.processes.push(record)
        state.peakProcesses = Math.max(state.peakProcesses, state.processes.filter(value => !value.ended).length)
        child.once('close', (code, signal) => { record.ended = true; record.endedAt = performance.now(); record.exitCode = code; record.signal = signal })
        return child
      },
    })
  })
}
async function nativeWaveformSnapshot(app) {
  return app.evaluate(() => {
    const state = globalThis.__videoMonitorNativeWaveforms.state
    return { ...state, liveWorkers: state.workers.filter(value => !value.ended).length, liveProcesses: state.processes.filter(value => !value.ended).length }
  })
}
async function waitNativeWaveformsReleased(app, page) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await nativeWaveformSnapshot(app)
    if (!value.liveWorkers && !value.liveProcesses) return value
    await page.waitForTimeout(50)
  }
  assert.fail('正式波形Worker或ffmpeg未在关闭后释放')
}
async function restoreNativeWaveformObservers(app) {
  await app.evaluate(() => {
    const value = globalThis.__videoMonitorNativeWaveforms
    if (!value) return
    value.threads.Worker = value.NativeWorker
    value.processes.spawn = value.nativeSpawn
    delete globalThis.__videoMonitorNativeWaveforms
  })
}
module.exports = { observeNativeWaveforms, nativeWaveformSnapshot, waitNativeWaveformsReleased, restoreNativeWaveformObservers }
