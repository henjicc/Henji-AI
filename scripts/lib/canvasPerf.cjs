function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * ratio) - 1)
  return sortedValues[index]
}

function summarizeFrameIntervals(frameIntervalsMs) {
  const sorted = [...frameIntervalsMs].sort((left, right) => left - right)
  return {
    sampleCount: sorted.length,
    p50Ms: Number(percentile(sorted, 0.5).toFixed(2)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(2)),
    p99Ms: Number(percentile(sorted, 0.99).toFixed(2)),
    maxMs: Number((sorted.at(-1) || 0).toFixed(2)),
    over25Ms: sorted.filter((duration) => duration > 25).length,
    over50Ms: sorted.filter((duration) => duration > 50).length,
  }
}

async function measureFpsWhileDriving(page, durationMs, driveFn) {
  const samplePromise = page.evaluate((duration) => {
    return new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      let previousFrameAt = start
      const frameIntervalsMs = []
      const longAnimationFrames = []
      let observer = null
      const collectLongAnimationFrames = (entries) => {
        for (const entry of entries) {
          if (entry.startTime < start) continue
          longAnimationFrames.push({
            durationMs: entry.duration,
            blockingDurationMs: entry.blockingDuration || 0,
          })
        }
      }

      if (PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
        observer = new PerformanceObserver((list) => {
          collectLongAnimationFrames(list.getEntries())
        })
        observer.observe({ type: 'long-animation-frame' })
      }

      function tick() {
        const now = performance.now()
        frames += 1
        frameIntervalsMs.push(now - previousFrameAt)
        previousFrameAt = now
        const elapsed = now - start
        if (elapsed >= duration) {
          if (observer) collectLongAnimationFrames(observer.takeRecords())
          observer?.disconnect()
          resolve({ frames, elapsedMs: elapsed, frameIntervalsMs, longAnimationFrames })
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, durationMs)
  await driveFn()
  const sample = await samplePromise
  const loafDurations = sample.longAnimationFrames.map((entry) => entry.durationMs)
  return {
    ...sample,
    frameTiming: summarizeFrameIntervals(sample.frameIntervalsMs),
    longAnimationFrame: {
      count: sample.longAnimationFrames.length,
      maxDurationMs: Number((Math.max(0, ...loafDurations)).toFixed(2)),
      totalBlockingDurationMs: Number(sample.longAnimationFrames
        .reduce((sum, entry) => sum + entry.blockingDurationMs, 0)
        .toFixed(2)),
    },
  }
}

async function driveZoomOscillation(page, durationMs) {
  const box = await page.locator('.react-flow').boundingBox()
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  const steps = Math.floor(durationMs / 60)
  for (let i = 0; i < steps; i += 1) {
    const deltaY = i % 2 === 0 ? -120 : 120
    await page.mouse.wheel(0, deltaY)
    await page.waitForTimeout(40)
  }
}

async function drivePan(page, durationMs) {
  // 仅供功能/内存冒烟：中心 ±30px 往返会反复命中相同绘制瓦片，不能代表持续露出新内容的
  // 平移性能。需要性能结论时使用 electron-canvas-pan-bench.cjs 的连续单向扫掠。
  const box = await page.locator('.react-flow').boundingBox()
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  const steps = Math.floor(durationMs / 60)
  for (let i = 0; i < steps; i += 1) {
    const dx = i % 2 === 0 ? 30 : -30
    await page.mouse.move(center.x + dx, center.y, { steps: 2 })
    await page.waitForTimeout(40)
  }
  await page.mouse.up()
}

async function readJsHeapBytes(page) {
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const { metrics } = await session.send('Performance.getMetrics')
  await session.detach().catch(() => undefined)
  return metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? null
}

module.exports = { measureFpsWhileDriving, driveZoomOscillation, drivePan, readJsHeapBytes }
