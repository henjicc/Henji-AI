const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')

// 显式专项：隔离资料中走正式历史加载、媒体协议和任务卡，不请求供应商。
function createGenerationPerformanceScenes(context) {
  if (process.env.GENERATION_BENCH !== '1') return []
  const counts = (process.env.GENERATION_BENCH_COUNTS || '100,1000,10000').split(',').map(Number)
  if (counts.some(count => !Number.isInteger(count) || count < 1 || count > 10000)) {
    throw new Error('GENERATION_BENCH_COUNTS 必须为 1 到 10000 的整数列表')
  }
  return [{
    id: 'generation-history-performance', surface: '生成', name: '生成-大规模历史性能', writesUserData: true,
    async setup(page, app, inspection) {
      const imagePath = process.env.GENERATION_BENCH_IMAGE
      if (!imagePath) throw new Error('GENERATION_BENCH_IMAGE 必须指向真实内容图片')
      const bytes = [...await fs.readFile(imagePath)]
      const extension = path.extname(imagePath).slice(1)
      const image = await page.evaluate(({ bytes, extension }) =>
        window.henjiNative.image.persistImageBinary(new Uint8Array(bytes), extension), { bytes, extension })
      const build = createHash('sha256')
        .update(await fs.readFile('out/main/index.cjs')).update(await fs.readFile('out/renderer/index.html')).digest('hex')
      const report = { collectedAt: new Date().toISOString(), checkoutCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), build,
        staleBuildDiagnostic: process.env.HENJI_SKIP_BUILD_FRESHNESS === '1',
        loadProfileDiagnostic: process.env.GENERATION_BENCH_LOAD_PROFILE === '1',
        scrollProfileDiagnostic: process.env.GENERATION_BENCH_SCROLL_PROFILE === '1',
        hardware: { cpu: os.cpus()[0].model, threads: os.cpus().length, memoryBytes: os.totalmem(),
          gpu: await app.evaluate(({ app }) => app.getGPUInfo('basic')) },
        imagePath, window: inspection.windowEvidence, runs: [] }
      const out = path.resolve(process.env.GENERATION_BENCH_OUT || '.ui-tour/generation-performance.json')
      await fs.mkdir(path.dirname(out), { recursive: true })
      await context.setupGeneration(page)
      for (const count of counts) {
        await page.evaluate(async ({ count, image }) => {
          await window.henjiNative.db.execute("DELETE FROM history WHERE id GLOB '__generation_bench_*'", [])
          for (let start = 0; start < count; start += 100) {
            const values = [], params = []
            for (let i = start; i < Math.min(count, start + 100); i++) {
              values.push('(?,?,?,?,?,?,?,?,?)')
              params.push(`__generation_bench_${i}`, 'kie', 'kie-z-image', 'image',
                `性能样本 ${i}：保留图像构图、细节和颜色。${'自然光与真实质感。'.repeat(i % 5)}`,
                JSON.stringify({ aspect_ratio: '1:1' }), image, 'success', new Date(1700000000000 + i * 1000).toISOString())
            }
            await window.henjiNative.db.execute('INSERT INTO history (id,provider_id,model_id,type,prompt,params,file_path,status,created_at) VALUES ' + values.join(','), params)
          }
        }, { count, image })
        const loadSession = report.loadProfileDiagnostic ? await page.context().newCDPSession(page) : null
        let loadMs
        try {
          if (loadSession) {
            await loadSession.send('Profiler.enable')
            await loadSession.send('Profiler.start')
          }
          const began = performance.now()
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.locator(`[data-generation-task-id="__generation_bench_${count - 1}"]`).waitFor({ timeout: 180000 })
          loadMs = performance.now() - began
          if (loadSession) {
            const { profile } = await loadSession.send('Profiler.stop')
            await fs.writeFile(`${out}.${count}.load.cpuprofile`, JSON.stringify(profile))
          }
        } finally { await loadSession?.detach() }
        await page.waitForTimeout(1500)
        const session = await page.context().newCDPSession(page)
        await session.send('Performance.enable')
        const samples = []
        try {
          for (let round = 0; round < 5; round++) {
            await page.evaluate(() => {
              const scroller = document.querySelector('.app-scroll-container')
              scroller.scrollTop = scroller.scrollHeight * 0.45
            })
            await page.waitForTimeout(250)
            if (report.scrollProfileDiagnostic && round === 0) {
              await session.send('Profiler.enable')
              await session.send('Profiler.start')
            }
            const before = await session.send('Performance.getMetrics')
            const sample = await page.evaluate(async () => {
              const element = document.querySelector('.app-scroll-container')
              const frames = [], longTasks = []
              const observer = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => entry.duration)))
              observer.observe({ type: 'longtask' })
              let last = 0, frame = 0
              const tick = time => { if (last) frames.push(time - last); last = time; frame = requestAnimationFrame(tick) }
              frame = requestAnimationFrame(tick)
              const start = performance.now(), startTop = element.scrollTop
              // 固定速度的连续单向滚动；计时器不会等待绘制帧。
              await new Promise(resolve => {
                const timer = setInterval(() => {
                  const elapsed = performance.now() - start
                  element.scrollTop = startTop + elapsed * 0.9
                  if (elapsed >= 1800) { clearInterval(timer); resolve() }
                }, 8)
              })
              const endedAt = performance.now()
              const tailFrameGapMs = last ? endedAt - last : 0
              // 最后一段阻塞可能发生在最后一个 RAF 之后，不能因停止采样而漏掉。
              if (tailFrameGapMs > 0) frames.push(tailFrameGapMs)
              cancelAnimationFrame(frame)
              await new Promise(resolve => setTimeout(resolve, 0))
              longTasks.push(...observer.takeRecords().map(entry => entry.duration))
              observer.disconnect()
              if (element.scrollTop - startTop < 1000 || frames.length < 5) throw new Error(`滚动采样无效：${JSON.stringify({ startTop, endTop: element.scrollTop, height: element.scrollHeight, frames: frames.length, elapsedMs: endedAt - start, cards: document.querySelectorAll('[data-generation-task-id]').length })}`)
              frames.sort((a, b) => a - b)
              return { elapsedMs: endedAt - start, scrollDistance: element.scrollTop - startTop,
                tailFrameGapMs, maxFrameGapMs: frames.at(-1),
                frames: frames.length, p95Ms: frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.95))],
                p99Ms: frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.99))],
                longTasks, mountedCards: document.querySelectorAll('[data-generation-task-id]').length }
            })
            const after = await session.send('Performance.getMetrics')
            if (report.scrollProfileDiagnostic && round === 0) {
              const { profile } = await session.send('Profiler.stop')
              await fs.writeFile(`${out}.${count}.scroll.cpuprofile`, JSON.stringify(profile))
            }
            const metric = (result, name) => result.metrics.find(item => item.name === name)?.value ?? null
            samples.push({ round, ...sample,
              scriptMs: (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000,
              taskMs: (metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000,
              heapBytes: metric(after, 'JSHeapUsedSize'), domNodes: metric(after, 'Nodes') })
          }
          report.runs.push({ count, loadMs, samples,
            processes: await app.evaluate(({ app }) => app.getAppMetrics()) })
          await fs.writeFile(out, JSON.stringify(report, null, 2))
          console.log('[generation-performance]', JSON.stringify(report.runs.at(-1)))
          await inspection.capture(`history-${count}`)
        } finally { await session.detach() }
      }
    },
  }]
}

module.exports = { createGenerationPerformanceScenes }
