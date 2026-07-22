const fs = require('node:fs')
const path = require('node:path')
const { launchElectronApp: launchElectronAppBase, waitForApp, assert } = require('./lib/electronLaunch.cjs')
const { buildNodes, buildEdges, computeFitViewport } = require('./lib/canvasStressFixtures.cjs')
const {
  measureFpsWhileDriving,
  driveZoomOscillation,
  drivePan,
  readJsHeapBytes,
} = require('./lib/canvasPerf.cjs')

const ROOT = path.resolve(__dirname, '..')
const MAIN_ENTRY = path.join(ROOT, 'out', 'main', 'index.cjs')
const SAMPLE_VIDEO_PATH = path.join(
  ROOT,
  'scripts/fixtures/plain_video.mp4'
)
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mP8z8Dwn4GBgYGJAQoAHxcCArzxVaIAAAAASUVORK5CYII='

const IMAGE_NODE_COUNT = Number(process.env.HENJI_STRESS_IMAGE_NODES || 60)
const VIDEO_NODE_COUNT = Number(process.env.HENJI_STRESS_VIDEO_NODES || 20)
const GEN_NODE_COUNT = Number(process.env.HENJI_STRESS_GEN_NODES || 50)
const STORYBOARD_NODE_COUNT = Number(process.env.HENJI_STRESS_STORYBOARD_NODES || 4)

// 资源加载失败（如个别媒体路径 403）不影响帧率结论，不应让压测直接失败拿不到数据；
// 其余控制台错误仍然阻断。
const IGNORABLE_CONSOLE_ERROR = /Failed to load resource/i

async function launchElectronApp() {
  return launchElectronAppBase({ mainEntry: MAIN_ENTRY, cwd: ROOT })
}

async function ensureProjectListVisible(page) {
  if (await page.locator('.react-flow').count() > 0) {
    await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
    await page.waitForTimeout(500)
  }
}

async function createEmptyProject(page, projectName) {
  await page.getByRole('button', { name: /新建项目|New Project/ }).click()
  const nameInput = page.getByRole('textbox')
  await nameInput.fill(projectName)
  await nameInput.press('Enter')
  await page.waitForSelector('.react-flow', { timeout: 15000 })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /返回项目|Back to Projects/ }).click()
  await page.waitForTimeout(700)
}

async function injectStressNodes(page, projectName, nodes, edges, viewport, samplePngVideoBase64) {
  return await page.evaluate(async ({ tinyPngDataUrl, samplePngVideoBase64, projectName, nodes, edges, viewport }) => {
    const native = window.henjiNative

    const rows = await native.db.select(
      'SELECT id FROM storyboard_projects WHERE name = ? ORDER BY created_at DESC LIMIT 1',
      [projectName]
    )
    if (!rows.length) {
      throw new Error('stress project not found in storyboard_projects')
    }
    const projectId = rows[0].id

    const tempDir = await native.paths.tempDir()
    const workDir = await native.paths.join(tempDir, `henji-canvas-stress-${Date.now()}`)
    await native.fs.mkdir(workDir, { recursive: true })

    const imagePath = await native.image.persistImageSource(tinyPngDataUrl)

    const videoPath = await native.paths.join(workDir, 'plain_video.mp4')
    const videoBytes = Uint8Array.from(atob(samplePngVideoBase64), (c) => c.charCodeAt(0))
    await native.fs.writeFile(videoPath, videoBytes)
    await native.media.allowRoot(workDir)

    const resolvedNodes = nodes.map((node) => {
      if (node.type === 'uploadNode') {
        return { ...node, data: { ...node.data, imageUrl: imagePath } }
      }
      if (node.type === 'videoUploadNode') {
        return { ...node, data: { ...node.data, videoUrl: videoPath } }
      }
      return node
    })

    await native.db.execute(
      `UPDATE storyboard_projects
       SET nodes_json = ?, edges_json = ?, viewport_json = ?, node_count = ?, updated_at = ?
       WHERE id = ?`,
      [
        JSON.stringify(resolvedNodes),
        JSON.stringify(edges),
        JSON.stringify(viewport),
        resolvedNodes.length,
        Date.now(),
        projectId,
      ]
    )

    return { projectId, workDir, nodeCount: resolvedNodes.length }
  }, {
    tinyPngDataUrl: TINY_PNG_DATA_URL,
    samplePngVideoBase64,
    projectName,
    nodes,
    edges,
    viewport,
  })
}

async function cleanupStressData(page, projectId, workDir) {
  await page.evaluate(async ({ projectId, workDir }) => {
    await window.henjiNative?.db.execute('DELETE FROM storyboard_projects WHERE id = ?', [projectId])
    await window.henjiNative?.fs.remove(workDir, { recursive: true })
  }, { projectId, workDir }).catch(() => undefined)
}

async function main() {
  if (!fs.existsSync(MAIN_ENTRY)) {
    throw new Error('Missing out/main/index.cjs. Run `npm run electron:build` before this stress test.')
  }
  if (!fs.existsSync(SAMPLE_VIDEO_PATH)) {
    throw new Error(`Missing sample video asset: ${SAMPLE_VIDEO_PATH}`)
  }
  const samplePngVideoBase64 = fs.readFileSync(SAMPLE_VIDEO_PATH).toString('base64')

  const totalNodes = IMAGE_NODE_COUNT + VIDEO_NODE_COUNT + GEN_NODE_COUNT + STORYBOARD_NODE_COUNT
  const viewport = computeFitViewport(totalNodes)
  const nodes = buildNodes(
    IMAGE_NODE_COUNT,
    VIDEO_NODE_COUNT,
    GEN_NODE_COUNT,
    STORYBOARD_NODE_COUNT
  )
  const edges = buildEdges(IMAGE_NODE_COUNT, GEN_NODE_COUNT)
  const projectName = `画布压测 ${Date.now()}`

  const consoleErrors = []
  const pageErrors = []
  const app = await launchElectronApp()
  let setupResult = null

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

    await page.getByRole('button', { name: /画布|Canvas/ }).click()
    await page.waitForTimeout(500)
    await ensureProjectListVisible(page)
    await createEmptyProject(page, projectName)

    setupResult = await injectStressNodes(page, projectName, nodes, edges, viewport, samplePngVideoBase64)
    assert(setupResult.nodeCount === totalNodes, `node count mismatch: ${setupResult.nodeCount}`)

    const loadStartedAt = Date.now()
    await page.getByRole('heading', { name: projectName }).click()
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
    const activePromptEditorCount = await page.evaluate(
      () => document.querySelectorAll('.ProseMirror[contenteditable="true"]').length
    )
    assert(
      activePromptEditorCount === 0,
      `inactive prompt editors should stay static: ${activePromptEditorCount} active instances`
    )

    const memoryBeforeBytes = await readJsHeapBytes(page)

    const baseline = await measureFpsWhileDriving(page, 1000, async () => {
      await page.waitForTimeout(1000)
    })

    const panResult = await measureFpsWhileDriving(page, 1200, () => drivePan(page, 1200))
    const zoomResult = await measureFpsWhileDriving(page, 1200, () => driveZoomOscillation(page, 1200))

    const memoryAfterBytes = await readJsHeapBytes(page)

    const blockingConsoleErrors = consoleErrors.filter((text) => !IGNORABLE_CONSOLE_ERROR.test(text))
    assert(pageErrors.length === 0, `page errors: ${pageErrors.join('\n')}`)
    assert(blockingConsoleErrors.length === 0, `console errors: ${blockingConsoleErrors.join('\n')}`)

    console.log(JSON.stringify({
      ok: true,
      launchMode: app.mode,
      totalNodes,
      promptNodeCount: GEN_NODE_COUNT,
      storyboardNodeCount: STORYBOARD_NODE_COUNT,
      renderedNodeCount,
      activePromptEditorCount,
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
    if (setupResult) {
      await ensureProjectListVisible(app.page).catch(() => undefined)
      await cleanupStressData(app.page, setupResult.projectId, setupResult.workDir)
    }
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
