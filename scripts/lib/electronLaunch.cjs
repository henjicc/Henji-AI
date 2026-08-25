const { _electron: electron, chromium } = require('playwright')
const electronExecutablePath = require('electron')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const process = require('node:process')

const ONBOARDING_STORAGE_KEY = 'henji-onboarding-state'
const AUTOMATION_ONBOARDING_STATE = JSON.stringify({
  version: 2,
  status: 'skipped',
  entryReason: 'existing_install',
  activeStepId: 'welcome',
  completedStepIds: [],
  configuredProviders: [],
  verifiedProviders: [],
  shownHintIds: [],
  firstTaskPrepared: false,
  firstTaskCompleted: false,
  startedAt: null,
  completedAt: new Date(0).toISOString(),
})

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

function appendProcessOutput(current, chunk) {
  const next = `${current}${chunk.toString()}`
  return next.length > 12000 ? next.slice(-12000) : next
}

function createIsolatedUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'henji-electron-test-'))
}

async function cleanupIsolatedUserDataDir(userDataDir) {
  if (!userDataDir) return
  const tempRoot = path.resolve(os.tmpdir())
  const resolved = path.resolve(userDataDir)
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('henji-electron-test-')) {
    throw new Error(`Refusing to remove unexpected Electron test profile: ${resolved}`)
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(resolved, { recursive: true, force: true })
      return
    } catch (error) {
      if (attempt === 7) throw error
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

async function stopElectronChild(child) {
  if (child.exitCode !== null) return
  child.kill()
  await Promise.race([
    once(child, 'exit'),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])
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

/**
 * 自动化测试不验证首次引导时，用一次 reload 在应用模块初始化前写入跳过态。
 * close() 会恢复原值，避免测试改变用户真实配置。
 */
async function suppressOnboardingForAutomation(page) {
  await page.waitForFunction(() => window.location.href !== 'about:blank', null, { timeout: 30000 })
  const previousValue = await page.evaluate(({ key, value }) => {
    const previous = window.localStorage.getItem(key)
    window.localStorage.setItem(key, value)
    return previous
  }, { key: ONBOARDING_STORAGE_KEY, value: AUTOMATION_ONBOARDING_STATE })
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, value)
  }, { key: ONBOARDING_STORAGE_KEY, value: AUTOMATION_ONBOARDING_STATE })
  await page.reload({ waitUntil: 'domcontentloaded' })

  return async () => {
    await page.evaluate(({ key, previous }) => {
      if (previous === null) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, previous)
    }, { key: ONBOARDING_STORAGE_KEY, previous: previousValue })
  }
}

async function launchElectronApp({
  mainEntry,
  cwd,
  extraEnv = {},
  isolateUserData = false,
  useElectronApi = false,
  skipOnboarding = false,
} = {}) {
  const userDataDir = isolateUserData ? createIsolatedUserDataDir() : null
  const launchArgs = userDataDir ? [`--user-data-dir=${userDataDir}`, mainEntry] : [mainEntry]
  // LOCALAPPDATA/APPDATA 只在 Windows 上决定数据目录；macOS / Linux 走
  // app.getPath('appData')，必须由主进程按 HENJI_ISOLATED_APP_DATA 重定向，
  // 否则 --user-data-dir 隔离的只是 Chromium 侧，业务数据仍写用户真实资料。
  const launchEnv = userDataDir
    ? {
        ...extraEnv,
        LOCALAPPDATA: path.join(userDataDir, 'local-app-data'),
        APPDATA: path.join(userDataDir, 'roaming-app-data'),
        HENJI_ISOLATED_APP_DATA: path.join(userDataDir, 'app-data'),
      }
    : extraEnv
  if (userDataDir) {
    fs.mkdirSync(launchEnv.LOCALAPPDATA, { recursive: true })
    fs.mkdirSync(launchEnv.APPDATA, { recursive: true })
    fs.mkdirSync(launchEnv.HENJI_ISOLATED_APP_DATA, { recursive: true })
  }
  if (useElectronApi || process.env.HENJI_SMOKE_USE_ELECTRON_API === '1') {
    try {
      const app = await electron.launch({
        executablePath: electronExecutablePath,
        args: launchArgs,
        cwd,
        env: createElectronEnv(launchEnv),
      })
      const page = await app.firstWindow({ timeout: 30000 })
      const restoreOnboarding = skipOnboarding
        ? await suppressOnboardingForAutomation(page)
        : null
      return {
        mode: 'electron-api',
        app,
        page,
        close: async () => {
          try {
            await restoreOnboarding?.().catch(() => undefined)
            if (!page.isClosed()) {
              const closed = page.waitForEvent('close', { timeout: 10000 }).catch(() => undefined)
              await page.evaluate(async () => { await window.henjiNative?.window.close() }).catch(() => undefined)
              await closed
            }
            await app.close().catch(() => undefined)
          } finally {
            await cleanupIsolatedUserDataDir(userDataDir)
          }
        },
      }
    } catch (error) {
      await cleanupIsolatedUserDataDir(userDataDir)
      throw error
    }
  }

  const port = getCdpPort()
  const child = spawn(
    electronExecutablePath,
    launchArgs,
    {
      cwd,
      env: createElectronEnv({
        HENJI_ELECTRON_REMOTE_DEBUGGING_PORT: String(port),
        ...launchEnv,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  )

  let processOutput = ''
  child.stdout.on('data', (chunk) => {
    processOutput = appendProcessOutput(processOutput, chunk)
  })
  child.stderr.on('data', (chunk) => {
    processOutput = appendProcessOutput(processOutput, chunk)
  })

  let browser = null
  try {
    await waitForCdp(port)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const page = await firstApplicationPage(browser)
    const restoreOnboarding = skipOnboarding
      ? await suppressOnboardingForAutomation(page)
      : null
    return {
      mode: 'cdp',
      browser,
      page,
      close: async () => {
        await restoreOnboarding?.().catch(() => undefined)
        if (!page.isClosed()) {
          const closed = page.waitForEvent('close', { timeout: 10000 }).catch(() => undefined)
          await page.evaluate(async () => { await window.henjiNative?.window.close() }).catch(() => undefined)
          await closed
        }
        await browser.close().catch(() => undefined)
        await stopElectronChild(child)
        await cleanupIsolatedUserDataDir(userDataDir)
      },
    }
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    await stopElectronChild(child)
    await cleanupIsolatedUserDataDir(userDataDir)
    const output = processOutput.trim()
    throw new Error(output ? `${error.message}\nElectron process output:\n${output}` : error.message, {
      cause: error,
    })
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
