'use strict'

// 正式渲染器的生产 bundle 在独立 Electron 中运行；不连接开发实例、不读取用户工程。
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ROOT = path.resolve(__dirname, '../..')
const statistics = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] }
}
async function openBenchPage(OUT) {
  const { assertBuildFreshness, launchElectronApp } = require('./electronLaunch.cjs')
  const mainEntry = path.join(ROOT, 'out/main/index.cjs')
  assertBuildFreshness(mainEntry)
  fs.mkdirSync(OUT, { recursive: true })
  const { build } = await import('vite')
  const { videoEditRenderEngineVersion } = await import('../vite/renderEngineVersion.mjs')
  await build({ configFile: false, logLevel: 'warn', root: path.join(ROOT, 'tests/fixtures/bench/video-edit/code-output'), base: './',
    plugins: [videoEditRenderEngineVersion({ root: ROOT })], resolve: { alias: { '@': path.join(ROOT, 'src') } }, worker: { format: 'es' },
    build: { outDir: path.join(OUT, 'renderer'), emptyOutDir: false, minify: false } })
  const launched = await launchElectronApp({ mainEntry, appPath: ROOT, cwd: ROOT, isolateUserData: true, useElectronApi: true })
  const { app, page } = launched
  try {
    const window = await app.browserWindow(page)
    await window.evaluate(win => { win.hide(); win.webContents.setBackgroundThrottling(false) })
    await window.dispose()
    await page.goto(require('node:url').pathToFileURL(path.join(OUT, 'renderer/index.html')).href)
    page.on('console', msg => { if (msg.type() === 'error') process.stderr.write(`${msg.text()}\n`) })
    page.on('pageerror', error => process.stderr.write(`${error.stack}\n`))
    await page.waitForFunction(() => typeof window.runCodeOutputBench === 'function')
    const runtime = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: await app.getGPUInfo('basic') }))
    return { launched, page, runtime }
  } catch (error) { await launched.close(); throw error }
}
async function runCodeOutputBench(options) {
  const OUT = options.out
  const { launched, page, runtime } = await openBenchPage(OUT)
  const evidence = { measurements: '1920×1080、30fps、三个重叠代码片段；八次热身后24次；Worker请求到GPU完成，不是物理扫描上屏。', runtime, runs: [] }
  try {
    for (const scenario of ['other-clip', 'parameter-gesture', 'external-transform', 'external-effect', 'still-playback', 'static-parameter']) {
      for (let round = 0; round < options.rounds; round++) for (const reuse of round % 2 ? [true, false] : [false, true]) {
        const started = performance.now()
        const result = await page.evaluate(async ({ scenario, reuse, diagnostics }) => {
          const started = performance.now(), result = await window.runCodeOutputBench(scenario, reuse, diagnostics)
          return { ...result, totalRequestMs: performance.now() - started }
        }, { scenario, reuse, diagnostics: options.diagnostics })
        fs.writeFileSync(path.join(OUT, `${scenario}-${reuse ? 'cached' : 'direct'}.png`), Buffer.from(result.png)); delete result.png
        if (options.diagnostics) assert.ok(result.samples.every(sample => Number.isFinite(sample.stages?.['gpu.frame'])), 'GPU 分段计时未返回，不能声称诊断完成')
        const hits = result.samples.reduce((sum, sample) => sum + sample.hits, 0)
        const row = { scenario, round, reuse, hits, opportunities: 24 * 3, requestToGpuMs: statistics(result.samples.map(value => value.elapsedMs)), authorCpuMs: statistics(result.samples.map(value => value.cpuMs)), ...result }
        evidence.runs.push(row)
        fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2))
        assert.equal(hits, reuse ? 24 * (scenario === 'other-clip' || scenario === 'parameter-gesture' || scenario === 'static-parameter' ? 2 : 3) : 0)
        console.log(JSON.stringify({ scenario, round, reuse, hits, ms: row.requestToGpuMs, elapsed: performance.now() - started }))
      }
      const runs = evidence.runs.filter(run => run.scenario === scenario)
      for (const run of runs) assert.equal(run.pixelDigest, runs[0].pixelDigest, `${scenario} 的正式合成像素不一致`)
    }
    evidence.completed = true
    fs.writeFileSync(path.join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2))
  } finally { await launched.close() }
}
/** 每个片段保留最近 capacity 个内容键（最近使用淘汰），回放同一串键得到命中数；capacity 为 1 即现行“只记上一帧”。 */
function replayHistory(samples, capacity) {
  const caches = [0, 1, 2].map(() => [])
  let hits = 0
  for (const sample of samples) sample.keys.forEach((key, clip) => {
    const cache = caches[clip], at = key === null ? -1 : cache.indexOf(key)
    if (at >= 0) { hits++; cache.splice(at, 1) }
    else if (cache.length >= capacity) cache.shift()
    if (key !== null) cache.push(key)
  })
  return hits
}
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length
const HISTORY_SCENARIOS = ['history-scrub', 'history-step', 'history-other-edit', 'history-loop']
const HISTORY_CAPACITIES = [1, 2, 4, 10, 30, 60, 120]
async function runCodeOutputHistoryBench(options) {
  const OUT = options.out
  const { launched, page, runtime } = await openBenchPage(OUT)
  const evidence = { measurements: '1920×1080、30fps、三个重叠且随时间变化的代码片段；Worker请求到GPU完成，不是物理扫描上屏。历史命中由正式路径逐帧登记的内容键按每片段最近使用淘汰回放得到。', runtime, runs: [], summary: [] }
  try {
    for (const count of [360, 3600]) for (const scenario of HISTORY_SCENARIOS) {
      for (let round = 0; round < options.rounds; round++) for (const reuse of round % 2 ? [true, false] : [false, true]) {
        const result = await page.evaluate(({ scenario, reuse, count }) => window.runCodeOutputBench(scenario, reuse, false, count), { scenario, reuse, count })
        evidence.runs.push({ count, scenario, round, reuse, ...result })
        fs.writeFileSync(path.join(OUT, 'history-evidence.json'), JSON.stringify(evidence, null, 2))
      }
      const runs = evidence.runs.filter(run => run.count === count && run.scenario === scenario)
      const direct = runs.filter(run => !run.reuse), cached = runs.filter(run => run.reuse)
      const opportunities = cached[0].samples.length * 3
      const measured = cached.map(run => run.samples.reduce((sum, sample) => sum + sample.hits, 0))
      // 现行路径实测命中必须等于容量 1 的回放，回放才算与正式键一致。
      for (const [index, run] of cached.entries()) assert.equal(replayHistory(run.samples, 1), measured[index], `${scenario} 回放与实测命中不一致`)
      const elapsed = list => list.flatMap(run => run.samples.map(sample => sample.elapsedMs))
      const repeat = (list, field) => statistics(list.flatMap(run => run.repeat.slice(1).map(sample => sample[field])))
      // 同帧重复请求时作者运行时内部也会复用，直接路径的重复帧不算完整重画；命中省下的按“逐帧都变的直接路径均值 − 全命中帧”计。
      const hitMs = repeat(cached, 'elapsedMs').p50
      const directMean = mean(elapsed(direct))
      // 只算输出目标本身：作者自己的画布栅格按片段计，不随保留帧数增加。
      const targetBytes = 1920 * 1080 * (cached[0].format === 'rgba16float' ? 8 : 4)
      const row = { count, scenario, opportunities, measuredLastHits: measured, directMs: { ...statistics(elapsed(direct)), mean: directMean }, lastOnlyMs: { ...statistics(elapsed(cached)), mean: mean(elapsed(cached)) },
        repeatFrameMs: { miss: repeat(direct, 'elapsedMs').p50, hit: hitMs }, targetFormat: cached[0].format, targetMiB: targetBytes / 1024 ** 2, authorCpuMs: { miss: repeat(direct, 'cpuMs').p50, hit: repeat(cached, 'cpuMs').p50 },
        history: HISTORY_CAPACITIES.map(capacity => {
          const hits = replayHistory(cached[0].samples, capacity)
          return { capacity, hits, hitRate: hits / opportunities, residentMiB: capacity * 3 * targetBytes / 1024 ** 2, estimatedMeanMs: directMean - hits / opportunities * (directMean - hitMs) }
        }) }
      evidence.summary.push(row)
      console.log(JSON.stringify({ count, scenario, direct: row.directMs, lastOnly: row.lastOnlyMs, repeat: row.repeatFrameMs, history: row.history.map(entry => `${entry.capacity}:${entry.hits}/${opportunities}≈${entry.estimatedMeanMs.toFixed(1)}ms@${Math.round(entry.residentMiB)}MiB`).join(' ') }))
    }
    evidence.completed = true
    fs.writeFileSync(path.join(OUT, 'history-evidence.json'), JSON.stringify(evidence, null, 2))
  } finally { await launched.close() }
}
module.exports = { runCodeOutputBench, runCodeOutputHistoryBench }
