const fs = require('node:fs')
const path = require('node:path')
const { launchElectronApp: launchElectronAppBase, waitForApp, assert } = require('./lib/electronLaunch.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')

const SCENARIOS = [
  { label: '1280x720@1x', width: 1280, height: 720, deviceScaleFactor: 1 },
  { label: '1920x1080@1x', width: 1920, height: 1080, deviceScaleFactor: 1 },
  { label: '1920x1080@1.5x', width: 1920, height: 1080, deviceScaleFactor: 1.5 },
  { label: '2560x1440@2x', width: 2560, height: 1440, deviceScaleFactor: 2 },
  { label: '3840x2160@2x', width: 3840, height: 2160, deviceScaleFactor: 2 },
  { label: '1366x768@1x', width: 1366, height: 768, deviceScaleFactor: 1 },
]

async function launchElectronApp() {
  return launchElectronAppBase({ mainEntry: MAIN_ENTRY, cwd: ROOT })
}

async function checkScenario(page, session, scenario) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: scenario.width,
    height: scenario.height,
    deviceScaleFactor: scenario.deviceScaleFactor,
    mobile: false,
  })
  await page.waitForTimeout(400)

  const result = await page.evaluate(({ width }) => {
    const titleBarButtons = Array.from(document.querySelectorAll('button')).filter((btn) =>
      /画布|Canvas|生成|对话|Generation|工具|Tools/.test(btn.textContent || '')
    )
    const visibleNavButtons = titleBarButtons.filter((btn) => {
      const rect = btn.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    })
    return {
      devicePixelRatio: window.devicePixelRatio,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      hasHorizontalOverflow: document.documentElement.scrollWidth > width + 4,
      navButtonCount: titleBarButtons.length,
      visibleNavButtonCount: visibleNavButtons.length,
    }
  }, { width: scenario.width })

  return result
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error('Missing out/main/index.cjs. Run `npm run electron:build` before this check.')
  }

  const consoleErrors = []
  const pageErrors = []
  const app = await launchElectronApp()

  try {
    const page = app.page
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await waitForApp(page)

    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1, height: 1, deviceScaleFactor: 0, mobile: false,
    }).catch(() => undefined)
    await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)

    const results = []
    for (const scenario of SCENARIOS) {
      const result = await checkScenario(page, session, scenario)
      results.push({ scenario: scenario.label, ...result })

      assert(
        Math.abs(result.devicePixelRatio - scenario.deviceScaleFactor) < 0.01,
        `devicePixelRatio mismatch for ${scenario.label}: expected ${scenario.deviceScaleFactor}, got ${result.devicePixelRatio}`
      )
      assert(
        !result.hasHorizontalOverflow,
        `horizontal overflow detected for ${scenario.label}: scrollWidth=${result.scrollWidth} > width=${scenario.width}`
      )
      assert(
        result.visibleNavButtonCount === result.navButtonCount && result.navButtonCount >= 3,
        `nav buttons not fully visible for ${scenario.label}: ${result.visibleNavButtonCount}/${result.navButtonCount}`
      )
    }

    await session.send('Emulation.clearDeviceMetricsOverride').catch(() => undefined)

    assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      launchMode: app.mode,
      results,
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
