const fs = require('node:fs')
const path = require('node:path')
const { launchElectronApp, waitForApp } = require('./electronLaunch.cjs')

const WINDOW_SIZE_TOLERANCE_PX = 2

const DEFAULT_WINDOW_SIZES = Object.freeze([
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 960, height: 640 }),
])

/*
 * 真实 Electron 巡检的已知约束：
 * 1. BrowserWindow 必须先 unmaximize() 再 setSize()，否则最大化状态会吞掉目标尺寸。
 * 2. 必须等待 window.henjiNative，不能只等首个 button，否则会截到初始化中间态。
 * 3. 必须使用隔离 userData，并同步隔离 LOCALAPPDATA / APPDATA，禁止碰用户真实数据。
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
  return { help, only, outDir, sizes }
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

async function closeTransientUi(page) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(240)

  const dialog = page.locator('[data-dialog="true"]:visible').last()
  if (await dialog.count()) {
    const closeButton = dialog.getByRole('button', { name: /关闭|Close/i }).last()
    if (await closeButton.count()) {
      await closeButton.click()
      await page.waitForTimeout(240)
    }
  }

  if (await page.locator('[data-asset-floating-panel]:visible').count()) {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(240)
  }

  // 助手停靠态不再自带关闭按钮（会和窗口关闭撞在同一条竖线上），统一走标题栏的开关
  const assistant = page.locator('aside[aria-label="智能助手"]:visible')
  if (await assistant.count()) {
    const toggleAssistant = page.locator('[title="智能助手"]').first()
    if (await toggleAssistant.count()) {
      await toggleAssistant.click()
      await page.waitForTimeout(240)
    }
  }
}

const TAB_NAMES = Object.freeze({
  generation: /^(生成|Generation)$/i,
  canvas: /^(画布|Canvas)$/i,
  toolbox: /^(工具箱|Toolbox)$/i,
  assets: /^(资产|Assets)$/i,
})

async function clickNamedButton(page, name) {
  const button = page.getByRole('button', { name }).filter({ visible: true }).first()
  await button.click({ timeout: 8000 })
}

async function openWorkspace(page, workspace) {
  await closeTransientUi(page)
  await clickNamedButton(page, TAB_NAMES[workspace])
  await settlePage(page, workspace === 'canvas' || workspace === 'assets' ? 700 : 400)
}

async function waitForPageHeader(page) {
  await page.locator('[data-ui-page-title]:visible').first().waitFor({ state: 'visible', timeout: 12000 })
}

async function setupGeneration(page) {
  await openWorkspace(page, 'generation')
  await waitForPageHeader(page)
}

async function setupSettings(page) {
  await setupGeneration(page)
  await clickNamedButton(page, /^(设置|Settings)$/i)
  await page.getByRole('dialog', { name: /设置|Settings/i }).waitFor({ state: 'visible', timeout: 8000 })
  await settlePage(page)
}

async function setupCanvas(page) {
  await openWorkspace(page, 'canvas')
  await waitForPageHeader(page)
}

async function setupToolbox(page) {
  await openWorkspace(page, 'toolbox')
  const backToToolbox = page.locator('[title="返回工具箱"]:visible').first()
  if (await backToToolbox.count()) {
    await backToToolbox.click()
    await settlePage(page)
  }
  await waitForPageHeader(page)
}

async function setupAssets(page) {
  await openWorkspace(page, 'assets')
  await page.locator('[data-asset-floating-panel]:visible').waitFor({ state: 'visible', timeout: 8000 })
  await clickNamedButton(page, /^(完整管理|Full manager)$/i)
  await waitForPageHeader(page)
  await settlePage(page, 700)
}

async function setupAssistant(page) {
  await setupGeneration(page)
  await page.locator('[title="智能助手"]').first().click({ timeout: 8000 })
  await page.locator('aside[aria-label="智能助手"]:visible').waitFor({ state: 'visible', timeout: 8000 })
  await settlePage(page)
}

const UI_INSPECTION_SCENES = Object.freeze([
  { id: 'generation-empty', surface: '生成', name: '生成-空态', setup: setupGeneration },
  {
    id: 'generation-model-panel',
    surface: '生成',
    name: '生成-模型选择面板',
    setup: async (page) => {
      await setupGeneration(page)
      const modelLabel = page.locator('label').filter({ hasText: /模型|Model/i }).first()
      await modelLabel.locator('..').locator('[data-panel-trigger-button]').click()
      await page.locator('input[placeholder*="模型"], input[placeholder*="model" i]').first().waitFor({ state: 'visible' })
      await settlePage(page)
    },
  },
  {
    id: 'generation-prompt-focus',
    surface: '生成',
    name: '生成-提示词聚焦',
    setup: async (page) => {
      await setupGeneration(page)
      await page.locator('[contenteditable="true"]').first().focus()
      await settlePage(page)
    },
  },
  {
    id: 'generation-optimize-context',
    surface: '生成',
    name: '生成-优化配置右键',
    setup: async (page) => {
      await setupGeneration(page)
      await page.locator('[title*="右键管理配置"]').click({ button: 'right' })
      await page.getByText('提示词优化配置', { exact: true }).waitFor({ state: 'visible' })
      await settlePage(page)
    },
  },
  { id: 'settings-general', surface: '设置', name: '设置-基础设置', setup: setupSettings },
  {
    id: 'settings-theme',
    surface: '设置',
    name: '设置-主题外观',
    setup: async (page) => {
      await setupSettings(page)
      await clickNamedButton(page, /^(界面|Interface)$/i)
      await clickNamedButton(page, /^主题外观$/)
      await settlePage(page)
    },
  },
  {
    id: 'settings-models',
    surface: '设置',
    name: '设置-模型显示管理',
    setup: async (page) => {
      await setupSettings(page)
      // 模型大类只有一个分节，目录里不再单独画「显示与管理」子项，点大类本身即可
      await clickNamedButton(page, /^(模型|Models)$/i)
      await settlePage(page)
    },
  },
  {
    id: 'settings-llm',
    surface: '设置',
    name: '设置-大语言模型',
    setup: async (page) => {
      await setupSettings(page)
      await clickNamedButton(page, /^(密钥|API Keys)$/i)
      await clickNamedButton(page, /^(大语言模型|Language Models)$/i)
      await settlePage(page, 700)
    },
  },
  {
    id: 'settings-agent-skills',
    surface: '设置',
    name: '设置-助手技能',
    setup: async (page) => {
      await setupSettings(page)
      await clickNamedButton(page, /^(密钥|API Keys)$/i)
      await clickNamedButton(page, /^(助手技能|Assistant Skills)$/i)
      await settlePage(page, 700)
    },
  },
  {
    id: 'settings-interface-layout',
    surface: '设置',
    name: '设置-界面布局',
    setup: async (page) => {
      await setupSettings(page)
      await clickNamedButton(page, /^(界面|Interface)$/i)
      await clickNamedButton(page, /^(布局行为|Layout Behavior)$/i)
      await settlePage(page)
    },
  },
  { id: 'canvas-projects', surface: '画布', name: '画布-项目列表', setup: setupCanvas },
  { id: 'toolbox-home', surface: '工具箱', name: '工具箱-首页', setup: setupToolbox },
  {
    id: 'toolbox-hover',
    surface: '工具箱',
    name: '工具箱-入口悬浮',
    setup: async (page) => {
      await setupToolbox(page)
      await page.locator('[data-ui-page-header] + div button').first().hover()
      await settlePage(page)
    },
  },
  {
    id: 'toolbox-image-edit',
    surface: '工具箱',
    name: '工具箱-图片编辑空态',
    setup: async (page) => {
      await setupToolbox(page)
      await clickNamedButton(page, /^(图片编辑|Image Edit)/i)
      await page.locator('[data-application-surface-id="tool.image_edit"]:visible').waitFor({ state: 'visible', timeout: 12000 })
      await page.getByRole('button', { name: /^(从文件打开|Open from file)$/i }).waitFor({ state: 'visible', timeout: 12000 })
      await settlePage(page, 700)
    },
  },
  {
    id: 'toolbox-camera-stage',
    surface: '工具箱',
    name: '工具箱-3D 镜头工程',
    setup: async (page) => {
      await setupToolbox(page)
      await clickNamedButton(page, /^(3D 镜头参考|3D Camera Reference)/i)
      await page.getByRole('button', { name: /^(新建工程|New Project)$/i }).waitFor({ state: 'visible', timeout: 12000 })
      await settlePage(page, 700)
    },
  },
  { id: 'assets-home', surface: '资产库', name: '资产库-首页', setup: setupAssets },
  {
    id: 'assets-search-focus',
    surface: '资产库',
    name: '资产库-搜索聚焦',
    setup: async (page) => {
      await setupAssets(page)
      await page.locator('input[placeholder*="资产"], input[placeholder*="asset" i]').first().focus()
      await settlePage(page)
    },
  },
  {
    id: 'assets-type-menu',
    surface: '资产库',
    name: '资产库-类型下拉',
    setup: async (page) => {
      await setupAssets(page)
      await clickNamedButton(page, /^(全部类型|All types)$/i)
      await settlePage(page)
    },
  },
  { id: 'assistant-home', surface: '助手', name: '助手-对话空态', setup: setupAssistant },
  {
    id: 'assistant-history',
    surface: '助手',
    name: '助手-运行历史',
    setup: async (page) => {
      await setupAssistant(page)
      await page.locator('[aria-label="对话历史"]').click()
      await settlePage(page)
    },
  },
  {
    id: 'assistant-focus',
    surface: '助手',
    name: '助手-输入聚焦',
    setup: async (page) => {
      await setupAssistant(page)
      await page.locator('[aria-label="向智能助手描述任务"]').focus()
      await settlePage(page)
    },
  },
  {
    id: 'assistant-memory',
    surface: '助手',
    name: '助手-记忆',
    setup: async (page) => {
      await setupAssistant(page)
      await page.locator('[aria-label="助手记忆"]').click()
      await settlePage(page)
    },
  },
])

async function launchUiInspectionApp({ root, mainEntry }) {
  if (!fs.existsSync(mainEntry)) {
    throw new Error(`未找到 Electron 构建产物：${mainEntry}\n请先运行 npm run electron:build`)
  }
  const app = await launchElectronApp({
    mainEntry,
    cwd: root,
    isolateUserData: true,
    useElectronApi: true,
  })
  try {
    await waitForApp(app.page)
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
  setInspectionWindowSize,
  settlePage,
}
