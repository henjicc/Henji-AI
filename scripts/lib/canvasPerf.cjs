async function measureFpsWhileDriving(page, durationMs, driveFn) {
  const samplePromise = page.evaluate((duration) => {
    return new Promise((resolve) => {
      let frames = 0
      const start = performance.now()
      function tick() {
        frames += 1
        const elapsed = performance.now() - start
        if (elapsed >= duration) {
          resolve({ frames, elapsedMs: elapsed })
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  }, durationMs)
  await driveFn()
  return samplePromise
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
