const TAB_NAMES = Object.freeze({
  generation: /^(生成|Generation)$/i,
  canvas: /^(画布|Canvas)$/i,
  toolbox: /^(工具箱|Toolbox)$/i,
  assets: /^(资产|Assets)$/i,
})

function createUiInspectionScenes({ settlePage }) {
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

    const assistant = page.locator('aside[aria-label="智能助手"]:visible')
    if (await assistant.count()) {
      const toggleAssistant = page.locator('[title="智能助手"]').first()
      if (await toggleAssistant.count()) {
        await toggleAssistant.click()
        await page.waitForTimeout(240)
      }
    }
  }

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
    for (const title of ['返回工程列表', '返回工具箱']) {
      const back = page.locator(`[title="${title}"]:visible, [aria-label="${title}"]:visible`).first()
      if (await back.count()) {
        await back.click()
        await settlePage(page)
      }
    }
    await waitForPageHeader(page)
  }

  async function setupCameraStageProjectList(page) {
    await setupToolbox(page)
    await clickNamedButton(page, /^(3D 镜头参考|3D Camera Reference)/i)
    await page.getByRole('button', { name: /^(新建工程|New Project)$/i }).first()
      .waitFor({ state: 'visible', timeout: 12000 })
  }

  async function setupCameraStageStyledEditor(page) {
    await setupCameraStageProjectList(page)
    await page.getByRole('button', { name: /^(新建工程|New Project)$/i }).first().click()
    const dialog = page.getByRole('dialog').last()
    await dialog.waitFor({ state: 'visible', timeout: 8000 })
    const input = dialog.getByRole('textbox')
    await input.fill('真实性巡检-3D镜头')
    await input.press('Enter')
    await page.locator('[title="添加球体"]:visible').waitFor({ state: 'visible', timeout: 12000 })
    await page.locator('[title="添加球体"]:visible').click()
    await page.locator('[title="添加摄像机"]:visible').click()
    const renderStyle = page.getByRole('button', { name: '渲染方式' }).filter({ visible: true }).first()
    await renderStyle.waitFor({ state: 'visible', timeout: 12000 })
    await renderStyle.click()
    await page.getByRole('option', { name: '线稿图', exact: true }).filter({ visible: true }).first().click()
    const cameraPane = page.locator('[data-camera-stage-viewport-id="camera"][data-camera-stage-render-style="lineart"]')
    await cameraPane.waitFor({ state: 'visible', timeout: 12000 })
    await cameraPane.click({ button: 'middle', position: { x: 320, y: 180 } })
    await settlePage(page, 900)
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

  return Object.freeze([
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
        await setupCameraStageProjectList(page)
        await settlePage(page, 700)
      },
    },
    {
      id: 'toolbox-camera-stage-lineart',
      surface: '工具箱',
      name: '工具箱-3D 镜头线稿成像',
      writesUserData: true,
      setup: setupCameraStageStyledEditor,
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
}

module.exports = { createUiInspectionScenes }
