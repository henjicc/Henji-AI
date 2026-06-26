const { _electron: electron, chromium } = require('playwright')
const electronExecutablePath = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4GBgYGJAQoAHxcCArzxVaIAAAAASUVORK5CYII='

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function waitForApp(page) {
  await page.waitForFunction(() => Boolean(window.henjiNative), null, { timeout: 30000 })
  await page.waitForSelector('button', { timeout: 30000 })
  await page.waitForTimeout(300)
}

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

async function launchElectronApp() {
  if (process.env.HENJI_SMOKE_USE_ELECTRON_API === '1') {
    const app = await electron.launch({
      executablePath: electronExecutablePath,
      args: [MAIN_ENTRY],
      cwd: ROOT,
      env: createElectronEnv(),
    })
    return {
      mode: 'electron-api',
      page: await app.firstWindow({ timeout: 30000 }),
      close: async () => {
        await app.close()
      },
    }
  }

  const port = getCdpPort()
  const child = spawn(
    electronExecutablePath,
    [MAIN_ENTRY],
    {
      cwd: ROOT,
      env: createElectronEnv({
        HENJI_ELECTRON_REMOTE_DEBUGGING_PORT: String(port),
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

async function checkNativeBridge(page) {
  return await page.evaluate(async ({ tinyPngDataUrl }) => {
    const native = window.henjiNative
    if (!native) {
      throw new Error('henjiNative is missing')
    }

    const tempDir = await native.paths.tempDir()
    const workDir = await native.paths.join(tempDir, `henji-phase4-smoke-${Date.now()}`)
    await native.fs.mkdir(workDir, { recursive: true })

    const textPath = await native.paths.join(workDir, 'roundtrip.txt')
    await native.fs.writeTextFile(textPath, 'phase4-smoke')
    const text = await native.fs.readTextFile(textPath)
    if (text !== 'phase4-smoke') {
      throw new Error('fs text roundtrip failed')
    }

    const ping = await native.diagnostics.ping()
    if (!ping.pong) {
      throw new Error('diagnostics ping failed')
    }

    const rows = await native.db.select(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('history', 'settings', 'canvas_projects') ORDER BY name"
    )
    const tableNames = rows.map((row) => row.name)
    for (const name of ['canvas_projects', 'history', 'settings']) {
      if (!tableNames.includes(name)) {
        throw new Error(`missing database table: ${name}`)
      }
    }

    const manifestCount = await native.ai.reloadModelManifest()
    if (!Number.isInteger(manifestCount) || manifestCount <= 0) {
      throw new Error('model manifest reload returned no models')
    }

    const status = await native.ai.getProviderKeyStatus()
    if (!Array.isArray(status) || status.length === 0) {
      throw new Error('provider key status is empty')
    }

    const persistedImage = await native.image.persistImageSource(tinyPngDataUrl)
    const info = await native.image.readImageInfo(persistedImage)
    if (info.width !== 2 || info.height !== 2) {
      throw new Error(`unexpected image info: ${info.width}x${info.height}`)
    }

    await native.media.allowRoot(workDir)
    const mediaPath = await native.paths.join(workDir, 'media.txt')
    await native.fs.writeTextFile(mediaPath, 'media-protocol-ok')
    const mediaResponse = await fetch(`henji-media://local/${encodeURIComponent(mediaPath)}`, {
      headers: { Range: 'bytes=0-4' },
    })
    if (mediaResponse.status !== 206) {
      throw new Error(`media range fetch returned ${mediaResponse.status}`)
    }
    const mediaText = await mediaResponse.text()
    if (mediaText !== 'media') {
      throw new Error('media range fetch content mismatch')
    }

    const packagePath = await native.paths.join(workDir, 'package.zip')
    const manifestJson = JSON.stringify({
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      project: { id: 'phase4-smoke', name: 'Phase 4 Smoke' },
    })
    await native.projectPackage.exportProjectPackage(
      manifestJson,
      [{ srcPath: mediaPath, packagePath: 'media/media.txt' }],
      packagePath
    )
    const imported = await native.projectPackage.importProjectPackage(packagePath)
    const importedManifest = JSON.parse(imported.manifestJson)
    if (importedManifest.project.id !== 'phase4-smoke') {
      throw new Error('project package manifest mismatch')
    }
    if (!imported.pathMap['media/media.txt']) {
      throw new Error('project package pathMap missing media file')
    }

    let dragRejected = false
    try {
      await native.drag.startNativeFileDrag('relative-file.txt')
    } catch {
      dragRejected = true
    }
    if (!dragRejected) {
      throw new Error('drag API accepted a relative path')
    }

    await native.fs.remove(workDir, { recursive: true })

    return {
      manifestCount,
      providerStatusCount: status.length,
      mediaUrl: `henji-media://local/${encodeURIComponent(mediaPath)}`,
    }
  }, { tinyPngDataUrl: TINY_PNG_DATA_URL })
}

async function checkWorkspaceShell(page) {
  let tempProjectName = null

  await page.getByRole('button', { name: /画布|Canvas/ }).click()
  await page.waitForTimeout(500)

  if (await page.locator('.react-flow').count() === 0) {
    tempProjectName = `Phase 4 Smoke ${Date.now()}`
    await page.getByRole('button', { name: /新建项目|New Project/ }).click()
    const nameInput = page.getByRole('textbox')
    await nameInput.fill(tempProjectName)
    await nameInput.press('Enter')
  }

  try {
    await page.waitForSelector('.react-flow', { timeout: 15000 })

    const canvasMetrics = await page.evaluate(async () => {
      const flow = document.querySelector('.react-flow')
      if (!flow) {
        throw new Error('React Flow canvas is missing')
      }

      const rect = flow.getBoundingClientRect()
      const before = performance.now()
      let frames = 0
      await new Promise((resolve) => {
        const tick = () => {
          frames += 1
          if (performance.now() - before >= 1000) {
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })

      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        frames,
        minimapCount: document.querySelectorAll('.canvas-minimap').length,
      }
    })

    assert(canvasMetrics.width >= 600, `canvas width is too small: ${canvasMetrics.width}`)
    assert(canvasMetrics.height >= 400, `canvas height is too small: ${canvasMetrics.height}`)
    assert(canvasMetrics.minimapCount >= 1, 'canvas minimap is missing')
    assert(canvasMetrics.frames >= 30, `requestAnimationFrame baseline is low: ${canvasMetrics.frames}`)

    await page.getByRole('button', { name: /工具|Tools/ }).click()
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /生成|对话|Generation/ }).click()
    await page.waitForTimeout(300)

    return canvasMetrics
  } finally {
    if (tempProjectName) {
      await page.getByRole('button', { name: /画布|Canvas/ }).click().catch(() => undefined)
      const returnButton = page.getByRole('button', { name: /返回项目|Back to Projects/ })
      if (await returnButton.count()) {
        await returnButton.click().catch(() => undefined)
        await page.waitForTimeout(500)
      }
      await page.evaluate(async (projectName) => {
        await window.henjiNative?.db.execute('DELETE FROM storyboard_projects WHERE name = ?', [projectName])
      }, tempProjectName).catch(() => undefined)
    }
  }
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error('Missing out/main/index.cjs. Run `npm run electron:build` before this smoke test.')
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
    const nativeResult = await checkNativeBridge(page)
    const canvasMetrics = await checkWorkspaceShell(page)

    assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      launchMode: app.mode,
      nativeResult: {
        manifestCount: nativeResult.manifestCount,
        providerStatusCount: nativeResult.providerStatusCount,
      },
      canvasMetrics,
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
