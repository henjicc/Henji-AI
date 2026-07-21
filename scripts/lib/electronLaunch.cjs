const { _electron: electron, chromium } = require('playwright')
const electronExecutablePath = require('electron')
const { spawn } = require('node:child_process')
const process = require('node:process')

function getCdpPort() {
  return 43000 + Math.floor(Math.random() * 10000)
}

function createElectronEnv(extra = {}) {
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    ...extra,
  }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function waitForCdp(port) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Electron CDP endpoint did not open: ${lastError?.message || 'timeout'}`)
}

async function firstApplicationPage(browser) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url()
        if (!url.startsWith('devtools://')) {
          return page
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('No Electron application page found over CDP')
}

async function launchElectronApp({ mainEntry, cwd, extraEnv = {} } = {}) {
  if (process.env.HENJI_SMOKE_USE_ELECTRON_API === '1') {
    const app = await electron.launch({
      executablePath: electronExecutablePath,
      args: [mainEntry],
      cwd,
      env: createElectronEnv(extraEnv),
    })
    return {
      mode: 'electron-api',
      app,
      page: await app.firstWindow({ timeout: 30000 }),
      close: async () => {
        await app.close()
      },
    }
  }

  const port = getCdpPort()
  const child = spawn(
    electronExecutablePath,
    [mainEntry],
    {
      cwd,
      env: createElectronEnv({
        HENJI_ELECTRON_REMOTE_DEBUGGING_PORT: String(port),
        ...extraEnv,
      }),
      stdio: 'ignore',
      windowsHide: true,
    }
  )

  let browser = null
  try {
    await waitForCdp(port)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = await firstApplicationPage(browser)
    return {
      mode: 'cdp',
      browser,
      page,
      close: async () => {
        await browser.close()
        child.kill()
      },
    }
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    child.kill()
    throw error
  }
}

async function waitForApp(page) {
  await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
  await page.waitForSelector('button', { timeout: 30000 })
  await page.waitForTimeout(300)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

module.exports = {
  launchElectronApp,
  waitForApp,
  assert,
  createElectronEnv,
}
