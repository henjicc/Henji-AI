const fs = require('node:fs')
const path = require('node:path')
const { launchElectronApp, waitForApp } = require('./electronLaunch.cjs')
const { createUiInspectionScenes } = require('./uiInspectionScenes.cjs')
const { inspectInspectionScreenshot } = require('./uiInspectionCapture.cjs')

const WINDOW_SIZE_TOLERANCE_PX = 2
const UI_INSPECTION_CANVAS_PROJECT_ID = '__henji_ui_inspection_canvas_fixture__'
const UI_INSPECTION_CANVAS_PROJECT_NAME = '__Henji UI Inspection Canvas Fixture__'
const UI_INSPECTION_QUICK_PROJECT_NAME = '回归-拖放连接与提示词换行'

const DEFAULT_WINDOW_SIZES = Object.freeze([
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 960, height: 640 }),
])

/*
 * 真实 Electron 巡检的已知约束：
 * 1. BrowserWindow 必须先 unmaximize() 再 setSize()，否则最大化状态会吞掉目标尺寸。
 * 2. 必须等待 window.henjiNative，不能只等首个 button，否则会截到初始化中间态。
 * 3. 默认使用隔离 userData，并同步隔离 LOCALAPPDATA / APPDATA；只有显式 --profile real 才复用
 *    用户正在使用的工程、设置与系统密钥链。
 * 4. performance.now() 在 Electron 中会被粗化；后续性能测量必须循环上百次取累计值。
 * 5. 早期 UiModal 无法用 Escape 关闭。如今已有键盘关闭能力，但场景重置仍会检查残留弹窗，
 *    避免单个交互失败污染后续所有截图。
 */

function parseWindowSize(value) {
  const match = /^(\d{3,5})x(\d{3,5})$/i.exec(String(value).trim())
  if (!match) {
    throw new Error(`无效窗口尺寸 "${value}"，请使用 1440x900 这类格式`)
  }
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 960 || height < 640) {
    throw new Error(`窗口尺寸不能小于项目下限 960x640：${value}`)
  }
  return { width, height }
}

function readOptionValue(argv, index, name) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 缺少参数值`)
  }
  return value
}

function parseUiInspectionArgs(argv, defaultOutDir) {
  const sizeValues = []
  const onlyValues = []
  let outDir = defaultOutDir
  let profile = 'temporary'
  let allowWrites = false
  let help = false
  let positionalOutUsed = false

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--help' || token === '-h') {
      help = true
      continue
    }
    if (token === '--size') {
      sizeValues.push(readOptionValue(argv, index, '--size'))
      index += 1
      continue
    }
    if (token.startsWith('--size=')) {
      sizeValues.push(token.slice('--size='.length))
      continue
    }
    if (token === '--only') {
      onlyValues.push(readOptionValue(argv, index, '--only'))
      index += 1
      continue
    }
    if (token.startsWith('--only=')) {
      onlyValues.push(token.slice('--only='.length))
      continue
    }
    if (token === '--out') {
      outDir = readOptionValue(argv, index, '--out')
      index += 1
      continue
    }
    if (token.startsWith('--out=')) {
      outDir = token.slice('--out='.length)
      continue
    }
    if (token === '--profile') {
      profile = readOptionValue(argv, index, '--profile')
      index += 1
      continue
    }
    if (token.startsWith('--profile=')) {
      profile = token.slice('--profile='.length)
      continue
    }
    if (token === '--real-data') {
      profile = 'real'
      continue
    }
    if (token === '--allow-writes') {
      allowWrites = true
      continue
    }
    if (!token.startsWith('--') && !positionalOutUsed) {
      outDir = token
      positionalOutUsed = true
      continue
    }
    throw new Error(`未知参数：${token}`)
  }

  const sizes = sizeValues.length > 0
    ? sizeValues.flatMap((value) => value.split(',')).filter(Boolean).map(parseWindowSize)
    : DEFAULT_WINDOW_SIZES.map((size) => ({ ...size }))
  const only = onlyValues.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  if (profile !== 'temporary' && profile !== 'real') {
    throw new Error('--profile 仅支持 temporary 或 real')
  }
  return { allowWrites, help, only, outDir, profile, sizes }
}

function selectInspectionScenes(scenes, options) {
  const blocked = options.profile === 'real' && !options.allowWrites
    ? scenes.filter((scene) => scene.writesUserData === true)
    : []
  const blockedIds = new Set(blocked.map((scene) => scene.id))
  return { blocked, scenes: scenes.filter((scene) => !blockedIds.has(scene.id)) }
}

function formatWindowSize(size) {
  return `${size.width}x${size.height}`
}

function filterScenes(scenes, only) {
  if (only.length === 0) return scenes
  const needles = only.map((value) => value.toLocaleLowerCase())
  return scenes.filter((scene) => {
    const haystack = `${scene.id} ${scene.surface} ${scene.name}`.toLocaleLowerCase()
    return needles.some((needle) => haystack.includes(needle))
  })
}

async function settlePage(page, delayMs = 350) {
  await page.waitForTimeout(delayMs)
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
}

const UI_INSPECTION_SCENES = createUiInspectionScenes({
  canvasFixtureProjectId: UI_INSPECTION_CANVAS_PROJECT_ID,
  settlePage,
})

async function seedCanvasInspectionFixture(page) {
  const seededAt = Date.now()
  await page.evaluate(async ({ projectId, projectName, now }) => {
    await window.henjiNative.db.execute(
      `INSERT OR IGNORE INTO storyboard_projects
       (id, name, created_at, updated_at, node_count, nodes_json, edges_json, viewport_json, history_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        projectName,
        now,
        now,
        0,
        '[]',
        '[]',
        JSON.stringify({ x: 120, y: 80, zoom: 0.85 }),
        JSON.stringify({ past: [], future: [], imagePool: [] }),
      ]
    )
    const rows = await window.henjiNative.db.select(
      'SELECT name FROM storyboard_projects WHERE id = ? LIMIT 1',
      [projectId]
    )
    if (rows[0]?.name !== projectName) {
      throw new Error('UI 巡检专用画布工程 ID 已被其他工程占用')
    }
  }, { projectId: UI_INSPECTION_CANVAS_PROJECT_ID, projectName: UI_INSPECTION_CANVAS_PROJECT_NAME, now: seededAt })
  return seededAt
}

async function cleanupCanvasInspectionFixtures(page, seededAt) {
  await page.evaluate(async ({ projectId, projectName, quickProjectName, cleanupAfter }) => {
    await window.henjiNative.db.execute(
      'DELETE FROM storyboard_projects WHERE (id = ? AND name = ?) OR (name = ? AND created_at >= ?)',
      [projectId, projectName, quickProjectName, cleanupAfter]
    )
  }, {
    projectId: UI_INSPECTION_CANVAS_PROJECT_ID,
    projectName: UI_INSPECTION_CANVAS_PROJECT_NAME,
    quickProjectName: UI_INSPECTION_QUICK_PROJECT_NAME,
    cleanupAfter: seededAt,
  })
}

async function launchUiInspectionApp({ root, mainEntry, extraEnv = {}, profile = 'temporary', readOnly = true }) {
  if (!fs.existsSync(mainEntry)) {
    throw new Error(`未找到 Electron 构建产物：${mainEntry}\n请先运行 npm run electron:bundle`)
  }
  const app = await launchElectronApp({
    mainEntry,
    cwd: root,
    isolateUserData: profile === 'temporary',
    useElectronApi: true,
    skipOnboarding: true,
    extraEnv: {
      HENJI_UI_INSPECTION_ALLOW_OVERSIZE: '1',
      HENJI_UI_INSPECTION_READ_ONLY: readOnly ? '1' : '0',
      ...extraEnv,
    },
  })
  try {
    await waitForApp(app.page)
    const shouldSeedCanvasFixture = profile === 'temporary' || !readOnly
    if (shouldSeedCanvasFixture) {
      const fixtureSeededAt = await seedCanvasInspectionFixture(app.page)
      const closeApp = app.close.bind(app)
      app.close = async () => {
        try {
          if (profile === 'real') {
            await cleanupCanvasInspectionFixtures(app.page, fixtureSeededAt)
          }
        } finally {
          await closeApp()
        }
      }
    }
    await settlePage(app.page, 900)
    return app
  } catch (error) {
    await app.close()
    throw error
  }
}

async function setInspectionWindowSize(app, size) {
  if (app.mode !== 'electron-api' || !app.app) {
    throw new Error('UI 巡检必须通过 Playwright Electron API 启动')
  }
  const browserWindow = await app.app.browserWindow(app.page)
  await browserWindow.evaluate((windowHandle, nextSize) => {
    windowHandle.unmaximize()
    windowHandle.setSize(nextSize.width, nextSize.height)
    windowHandle.center()
  }, size)
  const actualSize = await browserWindow.evaluate((windowHandle) => windowHandle.getSize())
  // 允许 ±2px：Windows 上无边框但保留 thickFrame 的窗口会带一圈不可见的缩放边，
  // 分数 DPI 缩放（125% / 150%）下 setSize 之后 getSize 稳定回 +1~+2。
  // 这是操作系统调整的结果，不是设置失败；严格相等会让整套巡检在这类机器上完全跑不起来。
  // 容差不能再放大：真正的"尺寸没设上"（比如漏了 unmaximize）差值是几百像素级别。
  if (
    Math.abs(actualSize[0] - size.width) > WINDOW_SIZE_TOLERANCE_PX ||
    Math.abs(actualSize[1] - size.height) > WINDOW_SIZE_TOLERANCE_PX
  ) {
    throw new Error(`窗口尺寸设置失败：期望 ${formatWindowSize(size)}，实际 ${actualSize.join('x')}`)
  }
  await settlePage(app.page, 450)
  const baseline = await readInspectionWindowEvidence(app)
  return assertInspectionWindowEvidence(size, baseline, baseline)
}

async function readInspectionWindowEvidence(app) {
  const windowHandle = await app.app.browserWindow(app.page)
  const native = await windowHandle.evaluate((handle) => ({
    outer: handle.getSize(), content: handle.getContentSize(), zoomFactor: handle.webContents.getZoomFactor(),
    bounds: handle.getBounds(),
  }))
  const nativeScaleFactor = await app.app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).scaleFactor, native.bounds)
  const renderer = await app.page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio }))
  return { outer: { width: native.outer[0], height: native.outer[1] },
    content: { width: native.content[0], height: native.content[1] },
    zoomFactor: native.zoomFactor, nativeScaleFactor, renderer }
}

/** --size 始终指 BrowserWindow 外框；CSS、内容区及 DPR 另列，不能混成同一尺寸。 */
function assertInspectionWindowEvidence(requested, baseline, current) {
  const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= WINDOW_SIZE_TOLERANCE_PX
  if (!near(current.outer.width, requested.width) || !near(current.outer.height, requested.height)
    || ['outer', 'content', 'renderer'].some((field) => ['width', 'height'].some((axis) => !near(current[field][axis], baseline[field][axis])))
    || current.renderer.dpr !== baseline.renderer.dpr || current.zoomFactor !== baseline.zoomFactor
    || current.nativeScaleFactor !== baseline.nativeScaleFactor
    || !Number.isFinite(current.nativeScaleFactor) || current.nativeScaleFactor <= 0
    || !Number.isFinite(current.zoomFactor) || current.zoomFactor <= 0
    || !Number.isFinite(current.renderer.dpr)
    || Math.abs(current.renderer.dpr - current.nativeScaleFactor * current.zoomFactor) > 1e-5
    || !near(current.renderer.width * current.zoomFactor, current.content.width)
    || !near(current.renderer.height * current.zoomFactor, current.content.height)) {
    throw new Error(`场景窗口尺寸发生漂移：${JSON.stringify({ requested, baseline, current })}`)
  }
  return current
}

async function assertInspectionWindowSize(app, requested, baseline) {
  return assertInspectionWindowEvidence(requested, baseline, await readInspectionWindowEvidence(app))
}

function resolveOutputDir(root, outDir) {
  return path.isAbsolute(outDir) ? outDir : path.resolve(root, outDir)
}

module.exports = {
  DEFAULT_WINDOW_SIZES,
  UI_INSPECTION_SCENES,
  filterScenes,
  formatWindowSize,
  launchUiInspectionApp,
  parseUiInspectionArgs,
  parseWindowSize,
  resolveOutputDir,
  selectInspectionScenes,
  setInspectionWindowSize,
  readInspectionWindowEvidence,
  assertInspectionWindowEvidence,
  assertInspectionWindowSize,
  inspectInspectionScreenshot,
  settlePage,
}
