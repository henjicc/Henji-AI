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
async function runCodeOutputBench(options) {
  const OUT = options.out
  const { assertBuildFreshness, launchElectronApp } = require('./electronLaunch.cjs')
  const mainEntry = path.join(ROOT, 'out/main/index.cjs')
  assertBuildFreshness(mainEntry)
  fs.mkdirSync(OUT, { recursive: true })
  const { build } = await import('vite')
  const { videoEditRenderEngineVersion } = await import('../vite/renderEngineVersion.mjs')
  await build({ configFile: false, logLevel: 'warn', root: path.join(ROOT, 'tests/fixtures/bench/video-edit/code-output'), base: './',
    plugins: [videoEditRenderEngineVersion()], resolve: { alias: { '@': path.join(ROOT, 'src') } }, worker: { format: 'es' },
    build: { outDir: path.join(OUT, 'renderer'), emptyOutDir: false, minify: false } })
  const launched = await launchElectronApp({ mainEntry, appPath: ROOT, cwd: ROOT, isolateUserData: true, useElectronApi: true })
  const { app, page } = launched
  const evidence = { measurements: '1920×1080、30fps、三个重叠代码片段；八次热身后24次；Worker请求到GPU完成，不是物理扫描上屏。', runs: [] }
  try {
    const window = await app.browserWindow(page)
    await window.evaluate(win => { win.hide(); win.webContents.setBackgroundThrottling(false) })
    await window.dispose()
    await page.goto(require('node:url').pathToFileURL(path.join(OUT, 'renderer/index.html')).href)
    page.on('console', msg => { if (msg.type() === 'error') process.stderr.write(`${msg.text()}\n`) })
    page.on('pageerror', error => process.stderr.write(`${error.stack}\n`))
    await page.waitForFunction(() => typeof window.runCodeOutputBench === 'function')
    evidence.runtime = await app.evaluate(async ({ app }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, gpu: await app.getGPUInfo('basic') }))
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
module.exports = { runCodeOutputBench }
