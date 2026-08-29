const fs = require('node:fs')
const path = require('node:path')
const { launchElectronApp: launchElectronAppBase, waitForApp, assert } = require('./lib/electronLaunch.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')

async function launchElectronApp() {
  return launchElectronAppBase({
    mainEntry: '.',
    cwd: ROOT,
    extraEnv: { HENJI_UPDATER_ALLOW_DEV: '1' },
  })
}

async function waitForStatus(page, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await page.evaluate(() => window.henjiNative.updater.getStatus())
    if (predicate(last)) {
      return last
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Timed out waiting for updater status. Last status: ${JSON.stringify(last)}`)
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error('Missing out/main/index.cjs. Run `npm run electron:bundle` before this test.')
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

    const checkResult = await page.evaluate(() => window.henjiNative.updater.checkForUpdates())
    assert(checkResult.status === 'available', `expected status=available, got ${JSON.stringify(checkResult)}`)
    assert(checkResult.latestVersion === '0.1.2', `expected latestVersion=0.1.2, got ${checkResult.latestVersion}`)

    const downloadStarted = await page.evaluate(() => window.henjiNative.updater.downloadUpdate())
    assert(downloadStarted.status === 'downloading' || downloadStarted.status === 'downloaded',
      `expected downloading/downloaded after downloadUpdate(), got ${downloadStarted.status}`)

    const downloaded = await waitForStatus(page, (s) => s.status === 'downloaded', 60000)
    assert(downloaded.latestVersion === '0.1.2', `downloaded status missing latestVersion: ${JSON.stringify(downloaded)}`)

    assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      checkResult,
      downloadStarted,
      downloaded,
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
