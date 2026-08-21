const path = require('node:path')
const { assert } = require('./lib/electronLaunch.cjs')
const {
  launchUiInspectionApp,
  setInspectionWindowSize,
} = require('./lib/uiInspection.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')

// 这里的宽高都是 Electron 的逻辑像素（DIP），不是显示器物理分辨率。
const LOGICAL_WINDOW_SCENARIOS = [
  { width: 960, height: 640, expectedZoomFactor: 0.9 },
  { width: 1280, height: 720, expectedZoomFactor: 0.9 },
  { width: 1440, height: 900, expectedZoomFactor: 0.9 },
  { width: 1512, height: 982, expectedZoomFactor: 0.9 },
  { width: 1920, height: 1080, expectedZoomFactor: 1 },
]

// DPR 单独变化，逻辑视口保持相同，证明高像素密度本身不会触发布局分支。
const DPR_SCENARIOS = [1, 1.5, 2]
const DPR_VIEWPORT = { width: 1280, height: 720 }

async function inspectRenderer(page) {
  return await page.evaluate(() => {
    const titleBarButtons = Array.from(document.querySelectorAll('button')).filter((button) =>
      /画布|Canvas|生成|对话|Generation|工具|Tools/.test(button.textContent || '')
    )
    const visibleNavButtons = titleBarButtons.filter((button) => {
      const rect = button.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    const root = document.documentElement
    return {
      devicePixelRatio: window.devicePixelRatio,
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      hasHorizontalOverflow: root.scrollWidth > root.clientWidth + 4,
      navButtonCount: titleBarButtons.length,
      visibleNavButtonCount: visibleNavButtons.length,
      uiScale: root.dataset.uiScale ?? null,
    }
  })
}

function assertRendererLayout(result, label) {
  assert(
    !result.hasHorizontalOverflow,
    `horizontal overflow detected for ${label}: scrollWidth=${result.scrollWidth}, clientWidth=${result.clientWidth}`
  )
  assert(
    result.visibleNavButtonCount === result.navButtonCount && result.navButtonCount >= 3,
    `nav buttons not fully visible for ${label}: ${result.visibleNavButtonCount}/${result.navButtonCount}`
  )
}

async function readElectronWindowState(app) {
  const browserWindow = await app.app.browserWindow(app.page)
  return await browserWindow.evaluate((windowHandle) => ({
    contentSize: windowHandle.getContentSize(),
    zoomFactor: windowHandle.webContents.getZoomFactor(),
  }))
}

async function checkLogicalWindowScenarios(app) {
  const results = []
  for (const scenario of LOGICAL_WINDOW_SCENARIOS) {
    await setInspectionWindowSize(app, scenario)
    await app.page.waitForTimeout(250)

    const electronState = await readElectronWindowState(app)
    const rendererState = await inspectRenderer(app.page)
    const label = `${scenario.width}x${scenario.height} logical`
    assertRendererLayout(rendererState, label)
    assert(
      Math.abs(electronState.zoomFactor - scenario.expectedZoomFactor) < 0.001,
      `zoom factor mismatch for ${label}: expected ${scenario.expectedZoomFactor}, got ${electronState.zoomFactor}`
    )
    assert(
      rendererState.uiScale === String(Math.round(scenario.expectedZoomFactor * 100)),
      `ui scale marker mismatch for ${label}: expected ${scenario.expectedZoomFactor * 100}, got ${rendererState.uiScale}`
    )

    results.push({
      scenario: label,
      expectedZoomFactor: scenario.expectedZoomFactor,
      ...electronState,
      ...rendererState,
    })
  }
  return results
}

async function checkDprScenarios(app) {
  const session = await app.page.context().newCDPSession(app.page)
  const results = []
  try {
    for (const deviceScaleFactor of DPR_SCENARIOS) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        ...DPR_VIEWPORT,
        deviceScaleFactor,
        mobile: false,
      })
      await app.page.waitForTimeout(250)

      const rendererState = await inspectRenderer(app.page)
      const label = `${DPR_VIEWPORT.width}x${DPR_VIEWPORT.height} logical @${deviceScaleFactor}x DPR`
      assertRendererLayout(rendererState, label)
      assert(
        Math.abs(rendererState.devicePixelRatio - deviceScaleFactor) < 0.01,
        `devicePixelRatio mismatch for ${label}: expected ${deviceScaleFactor}, got ${rendererState.devicePixelRatio}`
      )
      results.push({ scenario: label, ...rendererState })
    }
  } finally {
    await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)
  }
  return results
}

async function main() {
  const consoleErrors = []
  const pageErrors = []
  const app = await launchUiInspectionApp({ root: ROOT, mainEntry: MAIN_ENTRY })

  try {
    app.page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    app.page.on('pageerror', (error) => pageErrors.push(error.message))

    const logicalWindowResults = await checkLogicalWindowScenarios(app)
    const dprResults = await checkDprScenarios(app)

    assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      launchMode: app.mode,
      logicalWindowResults,
      dprResults,
      pageErrors,
      consoleErrors,
    }, null, 2))
  } finally {
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
