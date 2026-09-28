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

  return [
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
