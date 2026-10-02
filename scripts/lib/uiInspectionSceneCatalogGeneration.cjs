const assert = require('node:assert/strict')

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

  const ALT_THEME_MARKER = '__henjiUiTourAboutAltTheme'

  async function setAboutAppearance(page, { palette, blur }) {
    await clickNamedButton(page, /^主题外观$/)
    await clickNamedButton(page, palette)
    const blurRow = page.getByText('毛玻璃效果', { exact: true }).locator('xpath=ancestor::div[contains(@class, "justify-between")][1]')
    const blurSwitch = blurRow.getByRole('switch')
    if ((await blurSwitch.getAttribute('aria-checked') === 'true') !== blur) await blurSwitch.click()
  }

  /**
   * 巡检实例的资料在场景与尺寸之间共享且没有收尾钩子：对比主题场景留下标记，
   * 默认外观场景据此先恢复“经典深色 + 毛玻璃”。没有标记时什么都不写。
   */
  async function restoreDefaultAboutAppearance(page) {
    if (!await page.evaluate((key) => localStorage.getItem(key) === '1', ALT_THEME_MARKER)) return
    await setAboutAppearance(page, { palette: /经典深色/, blur: true })
    await page.evaluate((key) => localStorage.removeItem(key), ALT_THEME_MARKER)
  }

  /** 设置弹窗里定位到“关于”分区，等第三方清单加载、平滑滚动停稳后再截图。 */
  async function openAboutSection(page) {
    await clickNamedButton(page, /^(关于|About)$/i)
    // 第三方清单惰性加载，等重点组件列表出现；目录点击是平滑滚动，再等分区停到内容区顶部才截图
    await page.locator('#general-about').getByRole('button', { name: /FFmpeg/ }).waitFor({ state: 'visible', timeout: 8000 })
    await page.waitForFunction(() => {
      const section = document.getElementById('general-about')
      const body = section?.closest('.settings-scroll-body')
      if (!section || !body) return false
      const offset = section.getBoundingClientRect().top - body.getBoundingClientRect().top
      const state = window.__aboutScrollProbe ?? { top: -1, stable: 0 }
      state.stable = body.scrollTop === state.top ? state.stable + 1 : 0
      state.top = body.scrollTop
      window.__aboutScrollProbe = state
      return offset >= 0 && offset < 48 && state.stable >= 3
    }, null, { timeout: 8000, polling: 100 }).catch(async (error) => {
      const probe = await page.evaluate(() => {
        const section = document.getElementById('general-about')
        const body = section?.closest('.settings-scroll-body')
        return body && section ? {
          offset: section.getBoundingClientRect().top - body.getBoundingClientRect().top,
          scrollTop: body.scrollTop, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight,
          sectionHeight: section.getBoundingClientRect().height,
          spacer: body.lastElementChild?.getBoundingClientRect().height,
        } : null
      })
      throw new Error(`关于分区未停到顶部：${JSON.stringify(probe)}；${error.message}`)
    })
    await settlePage(page)
  }

  return [
    {
      id: 'generation-voice-selector', surface: '生成', name: '生成-音色筛选面板', writesUserData: true,
      setup: async (page, app, { capture }) => {
        await app.evaluate(({ ipcMain }) => {
          const channel = 'ai:listTtsVoices'
          globalThis.__voiceListHandler = ipcMain._invokeHandlers.get(channel)
          ipcMain.removeHandler(channel)
          ipcMain.handle(channel, () => ({ ok: true, data: [] }))
        })
        try {
          await context.selectGenerationModel(page, 'Qwen Audio', 'bailian-qwen-audio-3.1-tts-flash', 'bailian')
          await paramFieldFromLabel(page, /^(音色|Voice)\s*\*?$/i).locator('[data-panel-trigger-button]').click()
          const panel = page.locator('[data-voice-selector-panel]:visible')
          await panel.getByText('龙安欢_v3.1', { exact: true }).waitFor()
          await settlePage(page)
          const searchBox = await panel.getByRole('textbox', { name: '搜索音色' }).boundingBox()
          const refreshBox = await panel.getByRole('button', { name: '刷新音色' }).boundingBox()
          assert.ok(searchBox && refreshBox)
          assert.ok(Math.abs(searchBox.height - refreshBox.height) < 1, '搜索框和刷新按钮必须等高')
          const toolbarBox = await panel.locator('[data-voice-toolbar]').boundingBox()
          const panelBox = await panel.boundingBox()
          assert.ok(toolbarBox.height < panelBox.height / 4, '筛选工具栏最多占面板四分之一高度')
          if (capture) await capture('compact-voices')
          await panel.getByRole('button', { name: '音色语言' }).click()
          await page.getByRole('option', { name: '重庆话', exact: true }).click()
          await panel.getByText('龙安欢_v3.1', { exact: true }).waitFor()
          assert.equal(await panel.getByText('龙安灵心_v3.1', { exact: true }).count(), 0)
          await panel.getByRole('button', { name: '清除筛选' }).click()
          await panel.getByText('龙安灵心_v3.1', { exact: true }).waitFor()
        } finally {
          await app.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('ai:listTtsVoices')
            if (globalThis.__voiceListHandler) ipcMain.handle('ai:listTtsVoices', globalThis.__voiceListHandler)
            delete globalThis.__voiceListHandler
          })
        }
      },
    },
    {
      id: 'generation-voice-clone',
      surface: '生成',
      name: '生成-豆包语音',
      writesUserData: true,
      setup: async (page, app, { capture }) => {
        // 仅替换 IPC 边界：真实表单、任务与确认链路照常执行，不使用真实密钥或付费请求。
        await app.evaluate(({ ipcMain }) => {
          const channels = ['ai:getRuntimeProviderKeyStatus', 'ai:generate']
          globalThis.__voiceConfirmationFixture = { submitted: 0, handlers: channels.map(channel => [channel, ipcMain._invokeHandlers.get(channel)]) }
          ipcMain.removeHandler(channels[0])
          ipcMain.handle(channels[0], () => ({ ok: true, data: [{ providerId: 'volcengine-speech', configured: true }] }))
          ipcMain.removeHandler(channels[1])
          ipcMain.handle(channels[1], () => {
            globalThis.__voiceConfirmationFixture.submitted++
            return { ok: false, error: { code: 'FIXTURE_UNEXPECTED_SUBMISSION', message: '确认前不得提交' } }
          })
        })
        try {
          await page.reload()
          await context.selectGenerationModel(page, '豆包语音', 'volcengine-seed-icl-2.0', 'volcengine-speech')
          await paramFieldFromLabel(page, /^(音色|Voice)\s*\*?$/i).locator('[data-panel-trigger-button]').click()
          await page.getByText('云舟 2.0', { exact: true }).waitFor({ state: 'visible' })
          await settlePage(page)
          if (capture) await capture('system-voices')
          await page.keyboard.press('Escape')
          const mode = paramFieldFromLabel(page, /^(模式|Mode)$/i)
          await mode.locator('[data-dropdown-button]').click()
          await page.getByRole('option', { name: /^(克隆声音|Clone voice)$/i }).click()
          const name = page.getByText(/^(音色名称|Voice name)\s*\*?$/i).filter({ visible: true }).first().locator('xpath=ancestor::div[.//input][1]')
          await name.locator('input').fill('我的解说声音')
          const audio = page.getByText(/^(声音样本|Voice sample)\s*\*?$/i).filter({ visible: true }).first().locator('xpath=ancestor::div[.//input[@type="file"]][1]')
          await audio.locator('input[type="file"]').setInputFiles({ name: 'voice-sample.wav', mimeType: 'audio/wav', buffer: Buffer.from('RIFFfixture') })
          await page.getByText('voice-sample.wav', { exact: true }).or(page.getByText('文件 1', { exact: true })).waitFor({ state: 'visible', timeout: 8000 })
          await page.locator('[data-param-group-id="voice-clone-options"] [data-panel-trigger-button]').click()
          await page.getByText(/^(录音原文（可选）|Transcript \(optional\))$/i).first().waitFor({ state: 'visible', timeout: 8000 })
          await page.keyboard.press('Escape')
          await settlePage(page)
          await page.locator('[contenteditable="true"]').first().fill('你好，这是我的声音克隆试听。')
          await page.locator('[data-onboarding-target="generate"]').click()
          const dialog = page.getByRole('alertdialog')
          await dialog.getByText('确认克隆声音及费用', { exact: true }).waitFor()
          assert.match(await dialog.innerText(), /138/)
          assert.equal(await app.evaluate(() => globalThis.__voiceConfirmationFixture.submitted), 0)
          await settlePage(page)
          if (capture) await capture('clone-confirmation')
          await dialog.getByRole('button', { name: '取消', exact: true }).click()
          await dialog.waitFor({ state: 'hidden' })
          await page.getByText('已取消提交，未发送生成请求', { exact: true }).first().waitFor()
          assert.equal(await app.evaluate(() => globalThis.__voiceConfirmationFixture.submitted), 0)
        } finally {
          await app.evaluate(({ ipcMain }) => {
            for (const [channel, handler] of globalThis.__voiceConfirmationFixture.handlers) {
              ipcMain.removeHandler(channel)
              if (handler) ipcMain.handle(channel, handler)
            }
            delete globalThis.__voiceConfirmationFixture
          })
        }
      },
    },
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
      id: 'settings-about',
      surface: '设置',
      name: '设置-关于',
      setup: async (page) => {
        await setupSettings(page)
        await restoreDefaultAboutAppearance(page)
        await openAboutSection(page)
      },
    },
    {
      // 对比截图：在隔离实例里切到另一主题预设并关闭毛玻璃（应用没有浅色主题）
      id: 'settings-about-alt-theme',
      surface: '设置',
      name: '设置-关于-银盐灰阶无毛玻璃',
      writesUserData: true,
      setup: async (page) => {
        await setupSettings(page)
        await page.evaluate((key) => localStorage.setItem(key, '1'), ALT_THEME_MARKER)
        await setAboutAppearance(page, { palette: /银盐灰阶/, blur: false })
        await openAboutSection(page)
      },
    },
    {
      id: 'settings-about-licenses',
      surface: '设置',
      name: '设置-关于-第三方许可',
      setup: async (page) => {
        await setupSettings(page)
        await restoreDefaultAboutAppearance(page)
        await clickNamedButton(page, /^(关于|About)$/i)
        await page.locator('#general-about').getByRole('button', { name: /FFmpeg/ }).click({ timeout: 8000 })
        await page.getByRole('dialog', { name: /第三方开源组件|Third-party open source components/ })
          .getByText(/GNU GENERAL PUBLIC LICENSE/).first().waitFor({ state: 'visible', timeout: 8000 })
        await settlePage(page)
      },
    },
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
