/* eslint-disable @typescript-eslint/no-var-requires -- 正式 Electron 巡检场景沿用现有 CommonJS 工厂。 */
const assert = require('node:assert/strict')
const { blockPaidGeneration } = require('./uiReviewPaidGuard.cjs')

/** r5 第 4～10 条的隔离夹具；模型验证仅替换 IPC，不访问供应商。 */
function createF2UiScenes(context) {
  return [{
    id: 'f2-settings', surface: '设置', name: 'f2 助手模型失败与技能加载恢复', writesUserData: true,
    expectedLogEvents: ['agent_model_profile.verify.failed', 'settings.agent_skills.read.failed', 'settings.agent_user_instructions.read.failed'],
    setup: async (page, app, { capture }) => {
      const originals = await app.evaluate(({ ipcMain }) => {
        const channels = ['llm:verifyModelCapabilities', 'assistant:skills:list', 'assistant:userInstructions:get']
        globalThis.__f2Handlers = Object.fromEntries(channels.map(channel => [channel, ipcMain._invokeHandlers.get(channel)]))
        for (const channel of channels) ipcMain.removeHandler(channel)
        ipcMain.handle(channels[0], async () => { throw new Error('connection reset (isolated fixture)') })
        const pending = () => {
          let response
          const promise = new Promise(resolve => { response = resolve })
          return { promise, resolve: data => response({ ok: true, data }), reject: error => response({ ok: false, error: { name: 'Error', code: 'EIO', message: error.message } }) }
        }
        ipcMain.handle(channels[1], () => { globalThis.__f2Skills = pending(); return globalThis.__f2Skills.promise })
        ipcMain.handle(channels[2], () => { globalThis.__f2Instructions = pending(); return globalThis.__f2Instructions.promise })
        return channels
      })
      const baseline = await page.evaluate(async () => {
        const config = { providers: [], models: [], promptProfiles: [], agentProfiles: [],
          textProcessingPromptTemplates: [], tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {},
          ...await window.henjiNative.llm.readConfig() }
        const provider = { providerId: 'f2-fixture', displayName: '验收服务', adapter: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', enabled: true, setup: { kind: 'custom' } }
        const model = { providerId: provider.providerId, modelId: 'f2-model', displayName: '验收模型', adapter: provider.adapter, enabled: true,
          capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false, jsonOutput: true, structuredOutputMode: 'json', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: true } }
        const now = new Date().toISOString()
        const verification = { providerId: provider.providerId, modelId: model.modelId, adapterVersion: 'fixture', verifiedAt: now, totalLatencyMs: 50,
          checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel', 'image', 'video', 'audio'].map(id => ({ id, status: id === 'toolCall' ? 'failed' : ['image', 'video', 'audio'].includes(id) ? 'skipped' : 'passed', latencyMs: 0 })),
          usage: { inputTokens: null, outputTokens: null, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalTokens: null }, cost: { status: 'unknown' } }
        const profile = { id: 'f2-profile', name: '验收助手', primary: { providerId: provider.providerId, modelId: model.modelId }, verifications: [verification],
          settings: { timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 32768, contextWindowBudget: 32768 }, createdAt: now, updatedAt: now }
        await window.henjiNative.llm.writeConfig({ ...config, providers: [provider], models: [model], agentProfiles: [profile], selectedAgentProfileId: profile.id })
        return config
      })
      const shoot = async name => { await context.settlePage(page, 300); await capture(name) }
      try {
        await context.setupSettings(page)
        await context.clickNamedButton(page, /^助手模型$/)
        const modelSection = page.locator('#assistant-models')
        const details = modelSection.getByRole('button', { name: '详情', exact: true }).first()
        await details.click()
        await shoot('model-details-expanded')
        await modelSection.getByRole('button', { name: '验证此模型', exact: true }).click()
        await modelSection.getByRole('alert').getByText('验证没有完成', { exact: true }).waitFor()
        await modelSection.getByRole('alert').scrollIntoViewIfNeeded()
        await shoot('model-verification-failed')
        await modelSection.getByRole('button', { name: '重试', exact: true }).focus()
        await details.evaluate(button => button.click())
        assert.equal(await details.evaluate(button => document.activeElement === button), true, '收起时内部焦点交回展开按钮')
        assert.equal(await modelSection.getByRole('button', { name: '验证此模型', exact: true }).count(), 0)
        await context.settlePage(page, 300)
        await context.clickNamedButton(page, /^用户指令$/)
        const instructions = page.locator('#assistant-preferences')
        await instructions.getByRole('status').waitFor()
        await instructions.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
        await shoot('instructions-loading')
        await app.evaluate(() => globalThis.__f2Instructions.reject(new Error('指令文件暂时无法读取')))
        await instructions.getByRole('alert').waitFor()
        await instructions.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
        await shoot('instructions-failed')
        await context.clickNamedButton(page, /^助手技能$/)
        await page.getByText('正在读取技能清单…', { exact: true }).waitFor()
        assert.equal(await page.getByText('还没有自己的技能', { exact: true }).count(), 0)
        await shoot('skills-loading')
        await app.evaluate(() => globalThis.__f2Skills.reject(new Error('技能目录暂时无法读取')))
        await page.getByText('技能操作没有完成', { exact: true }).waitFor()
        await shoot('skills-failed')
        await app.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('assistant:skills:list')
          ipcMain.handle('assistant:skills:list', async () => ({ ok: true, data: { schemaVersion: 'assistant-skill/v1', skills: [], invalid: [] } }))
        })
        await page.getByRole('button', { name: '重试', exact: true }).click()
        await page.getByText('我的技能', { exact: true }).waitFor()
      } finally {
        await app.evaluate(({ ipcMain }, channels) => {
          for (const channel of channels) { ipcMain.removeHandler(channel); ipcMain.handle(channel, globalThis.__f2Handlers[channel]) }
          globalThis.__f2Instructions?.resolve({ content: '' })
          globalThis.__f2Skills?.resolve({ schemaVersion: 'assistant-skill/v1', skills: [], invalid: [] })
          delete globalThis.__f2Handlers
        }, originals)
        await page.evaluate(config => window.henjiNative.llm.writeConfig(config), baseline)
      }
    },
  }, {
    id: 'f2-image-editor', surface: '图片编辑', name: 'f2 智能对象单命令带与尺寸预览主动作', writesUserData: true,
    launchArgs: ['--dev-surface=tool.image_edit', '--dev-media=tests/fixtures/image-inpainting/face-scratch-source.png'],
    expectedLogEvents: ['image_edit.smart_content.update.failed', 'image_edit.v3.persistence.confirm.failed', 'image_edit.v3.document.autosave.failed'],
    setup: async (page, app, { capture }) => {
      const restore = await blockPaidGeneration(app)
      const host = () => page.locator('[data-image-editor-v3]:visible').last()
      try {
        await host().waitFor({ timeout: 30000 })
        await host().locator('[data-dock-tab="properties"] > span').first().click()
        await host().getByRole('button', { name: '转换为智能对象', exact: true }).click()
        await host().getByRole('button', { name: '打开内容', exact: true }).click()
        await page.locator('[data-smart-content-editor]').waitFor()
        await context.settlePage(page, 500)
        assert.equal(await page.locator('[data-smart-content-editor] [data-command-bar]').count(), 1)
        assert.equal(await host().locator('[data-command-bar-actions] button[data-export-readiness]').count(), 0)
        await capture('smart-content-single-command')
        await host().locator('[data-dock-tab="properties"] > span').first().click()
        await host().getByRole('tab', { name: '基础', exact: true }).click()
        const name = host().getByRole('textbox', { name: '名称', exact: true })
        await name.fill('编辑内容验收'); await name.press('Enter')
        await app.evaluate(({ ipcMain }) => {
          const channels = ['imageEditorV3:document:save', 'clipboard:readFiles', 'clipboard:readText', 'clipboard:readImage']
          globalThis.__f2InputHandlers = Object.fromEntries(channels.map(channel => [channel, ipcMain._invokeHandlers.get(channel)]))
          globalThis.__f2ClipboardReads = 0
          for (const channel of channels) {
            ipcMain.removeHandler(channel)
            ipcMain.handle(channel, async () => {
              if (channel.startsWith('clipboard:')) globalThis.__f2ClipboardReads++
              return { ok: false, error: { name: 'Error', code: 'ENOSPC', message: '磁盘空间不足，请清理空间后重试保存' } }
            })
          }
        })
        const restoreInputs = async () => app.evaluate(({ ipcMain }) => {
          if (!globalThis.__f2InputHandlers) return
          for (const [channel, handler] of Object.entries(globalThis.__f2InputHandlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
          delete globalThis.__f2InputHandlers
        })
        try {
          await host().getByRole('button', { name: '应用并返回', exact: true }).click()
          const retry = host().getByRole('button', { name: '重试保存并返回', exact: true })
          await retry.waitFor({ timeout: 30000 })
          await page.waitForFunction(() => document.querySelector('[data-smart-content-editor] [data-image-editor-v3]')?.getAttribute('data-editor-input-disabled') === 'true')
          const before = await host().locator('[data-command-bar]').getAttribute('data-document-revision')
          await retry.focus(); await retry.press('Control+z'); await retry.press('Control+v')
          assert.equal(await host().locator('[data-command-bar]').getAttribute('data-document-revision'), before, '冻结时宿主按钮焦点不能触发撤销')
          assert.equal(await app.evaluate(() => globalThis.__f2ClipboardReads), 0, '冻结时粘贴不读取用户剪贴板')
          assert.equal(await retry.isEnabled(), true)
          await context.settlePage(page, 500); await capture('smart-content-save-retry-enabled')
        } finally { await restoreInputs() }
        await host().getByRole('button', { name: '重试保存并返回', exact: true }).click()
        await page.locator('[data-smart-content-editor]').waitFor({ state: 'hidden', timeout: 30000 })
        await page.getByText('自动保存失败，请重试', { exact: true }).waitFor({ state: 'hidden', timeout: 30000 })
        await host().locator('[data-tool-id="free-transform"]').click()
        await page.getByRole('menuitem', { name: '画布与图像尺寸', exact: true }).click()
        const options = host().locator('[data-document-size-options]')
        await options.getByRole('button', { name: '调整尺寸', exact: true }).click()
        const input = page.locator('[data-document-size-configuration]').getByRole('spinbutton', { name: '宽度（像素）', exact: true })
        await input.fill(String(Number(await input.inputValue()) + 32)); await input.press('Enter')
        await page.getByRole('button', { name: '预览', exact: true }).click()
        await page.waitForFunction(() => [...document.querySelectorAll('[data-document-size-options] button')].some(button => button.textContent === '应用' && !button.disabled), null, { timeout: 60000 })
        await context.settlePage(page, 500)
        assert.equal(await host().locator('[data-command-stack] button[data-variant="primary"]:enabled').count(), 1)
        assert.equal(await host().locator('[data-command-bar-actions] button[data-export-readiness]').getAttribute('data-variant'), 'quiet')
        await capture('geometry-preview-primary')
        await options.getByRole('button', { name: '取消', exact: true }).click()
        assert.equal(await host().locator('[data-command-bar-actions] button[data-export-readiness]').getAttribute('data-variant'), 'primary')
        await host().getByRole('tab', { name: '参数', exact: true }).click()
        await host().getByRole('button', { name: '栅格化内容', exact: true }).click()
        await host().locator('[data-tool-id^="select-"]').click()
        await page.getByRole('menuitem', { name: '魔棒', exact: true }).click()
        const area = host().locator('[data-tool-overlay-slot="selection"] svg')
        const bounds = await area.boundingBox()
        assert.ok(bounds)
        await area.click({ position: { x: bounds.width * .45, y: bounds.height * .4 } })
        await host().getByRole('button', { name: '选区设置', exact: true }).click()
        const selectionSettings = page.locator('[data-selection-advanced-settings]:visible')
        await selectionSettings.getByRole('button', { name: '预览', exact: true }).click()
        await page.waitForFunction(() => [...document.querySelectorAll('[data-selection-advanced-settings] button')].some(button => button.textContent === '应用选区' && !button.disabled), null, { timeout: 60000 })
        await page.keyboard.press('Escape')
        await context.settlePage(page, 500)
        assert.equal(await host().locator('[data-command-stack] button[data-variant="primary"]:enabled').count(), 1)
        assert.equal(await host().locator('[data-command-bar-actions] button[data-export-readiness]').getAttribute('data-variant'), 'quiet')
        await capture('advanced-selection-preview-primary')
        await host().locator('[data-selection-advanced-options]').getByRole('button', { name: '取消', exact: true }).click()
        assert.equal(await host().locator('[data-command-bar-actions] button[data-export-readiness]').getAttribute('data-variant'), 'primary')
        await host().getByRole('button', { name: '应用选区', exact: true }).waitFor({ state: 'hidden' })
        await context.settlePage(page, 300)
      } finally { await restore() }
    },
  }, {
    id: 'f2-paid-english', surface: '付费确认', name: 'f2 英文费用确认',
    launchArgs: ['--dev-surface=dev.ui_gallery'],
    setup: async (page, _app, { capture }) => {
      await page.evaluate(() => localStorage.setItem('henji-language', 'en-US'))
      await page.reload()
      await page.locator('[data-paid-approval-fixture]').click()
      const dialog = page.getByRole('alertdialog', { name: 'Send this explanation to AI?' })
      await dialog.waitFor()
      assert.ok((await dialog.innerText()).includes('Estimated cost: CNY 1.25'))
      assert.equal(await dialog.getByRole('button', { name: 'Allow once' }).getAttribute('data-variant'), 'primary')
      await context.settlePage(page, 500)
      await capture('paid-approval-english')
    },
  }]
}
module.exports = { createF2UiScenes }
