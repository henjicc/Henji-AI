const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')
const Database = require('better-sqlite3')
const { buildNodes, computeFitViewport } = require('./lib/canvasStressFixtures.cjs')
const {
  measureFpsWhileDriving,
  driveZoomOscillation,
  drivePan,
  readJsHeapBytes,
} = require('./lib/canvasPerf.cjs')

const ROOT = path.resolve(__dirname, '..')
const TAURI_EXE = path.join(ROOT, 'src-tauri', 'target', 'debug', 'henji-ai.exe')
const SAMPLE_VIDEO_PATH = path.join(
  ROOT,
  'docs/ref/ComfyUI_frontend/browser_tests/assets/plain_video.mp4'
)
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4GBgYGJAQoAHxcCArzxVaIAAAAASUVORK5CYII='
const DB_PATH = path.join(process.env.LOCALAPPDATA, 'com.henji.ai', 'Henji-AI', 'henji.db')
const DEV_URL = 'http://localhost:3000'

const IMAGE_NODE_COUNT = Number(process.env.HENJI_STRESS_IMAGE_NODES || 60)
const VIDEO_NODE_COUNT = Number(process.env.HENJI_STRESS_VIDEO_NODES || 20)

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 404) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message || 'no response'}`)
}

async function waitForCdp(port) {
  await waitForHttp(`http://127.0.0.1:${port}/json/version`, 30000)
}

async function firstAppPage(browser) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (page.url().startsWith(DEV_URL)) {
          return page
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('No Tauri WebView2 page found over CDP')
}

function insertStressProject(workDir, nodes, viewport) {
  const db = new Database(DB_PATH)
  try {
    const imagePath = path.join(workDir, 'stress.png')
    fs.writeFileSync(imagePath, Buffer.from(TINY_PNG_BASE64, 'base64'))
    const videoPath = path.join(workDir, 'plain_video.mp4')
    fs.copyFileSync(SAMPLE_VIDEO_PATH, videoPath)

    const resolvedNodes = nodes.map((node) => {
      if (node.type === 'uploadNode') {
        return { ...node, data: { ...node.data, imageUrl: imagePath } }
      }
      return { ...node, data: { ...node.data, videoUrl: videoPath } }
    })

    const projectId = `tauri-stress-${Date.now()}`
    const projectName = `画布压测Tauri ${Date.now()}`
    const now = Date.now()
    db.prepare(
      `INSERT INTO storyboard_projects (
        id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      projectId,
      projectName,
      now,
      now,
      resolvedNodes.length,
      JSON.stringify(resolvedNodes),
      JSON.stringify([]),
      JSON.stringify(viewport),
      JSON.stringify({ past: [], future: [], imagePool: [] })
    )

    return { projectId, projectName, nodeCount: resolvedNodes.length, imagePath, videoPath }
  } finally {
    db.close()
  }
}

function deleteStressProject(projectId) {
  const db = new Database(DB_PATH)
  try {
    db.prepare('DELETE FROM storyboard_projects WHERE id = ?').run(projectId)
  } finally {
    db.close()
  }
}

async function main() {
  if (!fs.existsSync(TAURI_EXE)) {
    throw new Error(`Missing Tauri debug exe: ${TAURI_EXE}. Build with \`npm run tauri:dev\` or \`cargo build\` first.`)
  }
  if (!fs.existsSync(SAMPLE_VIDEO_PATH)) {
    throw new Error(`Missing sample video asset: ${SAMPLE_VIDEO_PATH}`)
  }

  const totalNodes = IMAGE_NODE_COUNT + VIDEO_NODE_COUNT
  const viewport = computeFitViewport(totalNodes)
  const nodes = buildNodes(IMAGE_NODE_COUNT, VIDEO_NODE_COUNT)

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-tauri-stress-'))
  const setupResult = insertStressProject(workDir, nodes, viewport)

  console.error('等待 Vite 开发服务器就绪…')
  await waitForHttp(DEV_URL, 60000)

  const cdpPort = 49000 + Math.floor(Math.random() * 5000)
  console.error(`启动 Tauri 调试构建，远程调试端口 ${cdpPort}…`)
  const child = spawn(TAURI_EXE, [], {
    cwd: ROOT,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
    },
    stdio: 'ignore',
    windowsHide: true,
  })

  let browser = null
  const consoleErrors = []
  const pageErrors = []

  try {
    await waitForCdp(cdpPort)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
    const page = await firstAppPage(browser)

    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(error.message)
    })

    await page.waitForSelector('button', { timeout: 30000 })
    await page.waitForTimeout(500)

    await page.getByRole('button', { name: /画布|Canvas/ }).click()
    await page.waitForTimeout(500)

    const loadStartedAt = Date.now()
    await page.getByRole('heading', { name: setupResult.projectName }).click({ timeout: 60000 })
    await page.waitForSelector('.react-flow', { timeout: 20000 })
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
      totalNodes,
      { timeout: 20000 }
    )
    await page.waitForTimeout(300)
    const loadElapsedMs = Date.now() - loadStartedAt

    const renderedNodeCount = await page.evaluate(
      () => document.querySelectorAll('.react-flow__node').length
    )

    const memoryBeforeBytes = await readJsHeapBytes(page)

    const baseline = await measureFpsWhileDriving(page, 1000, async () => {
      await page.waitForTimeout(1000)
    })
    const panResult = await measureFpsWhileDriving(page, 1200, () => drivePan(page, 1200))
    const zoomResult = await measureFpsWhileDriving(page, 1200, () => driveZoomOscillation(page, 1200))

    const memoryAfterBytes = await readJsHeapBytes(page)

    assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
    assert(consoleErrors.length === 0, `console errors: ${consoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      shell: 'tauri-debug-devurl',
      totalNodes,
      renderedNodeCount,
      loadElapsedMs,
      fps: {
        idle: Math.round((baseline.frames / baseline.elapsedMs) * 1000),
        pan: Math.round((panResult.frames / panResult.elapsedMs) * 1000),
        zoom: Math.round((zoomResult.frames / zoomResult.elapsedMs) * 1000),
      },
      jsHeapUsedMb: {
        before: memoryBeforeBytes ? Math.round(memoryBeforeBytes / 1024 / 1024) : null,
        after: memoryAfterBytes ? Math.round(memoryAfterBytes / 1024 / 1024) : null,
      },
      pageErrors,
      consoleErrors,
    }, null, 2))
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
    child.kill()
    deleteStressProject(setupResult.projectId)
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
