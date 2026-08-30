function createGenerationSettingsScenes(context) {
  const {
    settlePage,
    clickNamedButton,
    paramFieldFromLabel,
    setupGeneration,
    openGenerationModelPanel,
    setupGenerationModelSearch,
    setupGenerationMidjourneySettings,
    setupGenerationGptMask,
    setupSettings,
  } = context

  return [
    { id: 'generation-empty', surface: '生成', name: '生成-空态', setup: setupGeneration },
    {
      id: 'generation-model-panel',
      surface: '生成',
      name: '生成-模型选择面板',
      setup: async (page) => {
        await openGenerationModelPanel(page)
        await settlePage(page)
      },
    },
    {
      id: 'generation-model-midjourney',
      surface: '生成',
      name: '生成-模型合并-Midjourney',
      setup: async (page) => setupGenerationModelSearch(
        page,
        'Midjourney',
        'apimart-midjourney',
        ['apimart-midjourney-edit', 'apimart-midjourney-blend'],
      ),
    },
    {
      id: 'generation-model-gemini-omni',
      surface: '生成',
      name: '生成-模型合并-Gemini Omni',
      setup: async (page) => setupGenerationModelSearch(
        page,
        'Gemini Omni',
        'apimart-gemini-omni-flash',
        ['apimart-gemini-omni-flash-ext'],
      ),
    },
    {
      id: 'generation-model-gpt-image-2',
      surface: '生成',
      name: '生成-模型合并与渠道-GPT Image 2',
      setup: async (page) => {
        const modelButton = await setupGenerationModelSearch(
          page, 'GPT Image 2', 'apimart-gpt-image-2', ['apimart-gpt-image-2-official'],
        )
        await modelButton.click()
        await page.locator('[data-model-selector-panel]:visible').waitFor({ state: 'hidden', timeout: 8000 })
        const channelField = paramFieldFromLabel(page, /^(渠道|Channel)$/i)
        await channelField.locator('[data-dropdown-button]').click()
        await page.getByRole('option', { name: /^(普通|Standard)$/i }).waitFor({ state: 'visible', timeout: 8000 })
        await page.getByRole('option', { name: /^(官方|Official)$/i }).waitFor({ state: 'visible', timeout: 8000 })
        await page.keyboard.press('Escape')
        await settlePage(page)
      },
    },
    {
      id: 'generation-midjourney-settings',
      surface: '生成',
      name: '生成-Midjourney 参数特殊面板',
      setup: async (page) => setupGenerationMidjourneySettings(page, false),
    },
    {
      id: 'generation-midjourney-reference',
      surface: '生成',
      name: '生成-Midjourney 参考图与权重',
      setup: async (page) => setupGenerationMidjourneySettings(page, true),
    },
    {
      id: 'generation-gpt-mask-control',
      surface: '生成',
      name: '生成-GPT Image 2 遮罩说明与绘制入口',
      setup: async (page) => setupGenerationGptMask(page, false),
    },
    {
      id: 'generation-gpt-mask-editor',
      surface: '生成',
      name: '生成-GPT Image 2 遮罩编辑器',
      setup: async (page) => setupGenerationGptMask(page, true),
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
      id: 'settings-provider-center',
      surface: '设置',
      name: '设置-供应商与模型',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^KIE$/)
        await settlePage(page)
      },
    },
    {
      id: 'settings-models-alias',
      surface: '设置',
      name: '设置-模型别名',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^(别名|Aliases)$/i)
        await settlePage(page)
      },
    },
    {
      id: 'settings-assistant-models',
      surface: '设置',
      name: '设置-助手模型',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^(助手模型|Assistant Models)$/i)
        await settlePage(page, 700)
      },
    },
    {
      id: 'settings-provider-manager',
      surface: '设置',
      name: '设置-添加供应商',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(模型|Models)$/i)
        await clickNamedButton(page, /^(添加供应商|Add provider)$/i)
        const dialog = page.getByRole('dialog', { name: /添加大语言模型供应商|Add LLM Provider/i })
        await dialog.waitFor({ state: 'visible' })
        await clickNamedButton(dialog, /^(接入方式|Connection type)$/i)
        await page.getByRole('option', { name: /^(火山引擎（豆包）|Volcengine.*)$/i }).click()
        await settlePage(page, 700)
      },
    },
    {
      id: 'settings-agent-skills',
      surface: '设置',
      name: '设置-助手技能',
      setup: async (page) => {
        await setupSettings(page)
        await clickNamedButton(page, /^(助手|Assistant)$/i)
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
  ]
}

module.exports = { createGenerationSettingsScenes }
