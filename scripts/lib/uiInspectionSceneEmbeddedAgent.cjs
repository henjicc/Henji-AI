const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const path = require('node:path')

// 官方 Pi + 真实 utility process / preload / 应用工具；只用本地模型响应替身，不访问外部模型。
function createEmbeddedAgentScenes(context) {
  return [{ id: 'embedded-agent', surface: '助手', name: '内置助手-对话工具停止与恢复', writesUserData: true,
    setup: async (page) => {
      const requests = []
      let waiting = false
      const server = createServer(async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString())
        requests.push(body)
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders()
        if (waiting) return
        const called = body.messages.some((message) => message.role === 'tool')
        const delta = called ? { content: '已读取当前主题设置。' } : { tool_calls: [{ index: 0, id: 'call_read_theme', type: 'function',
          function: { name: 'read_application_entity', arguments: JSON.stringify({ ref: { kind: 'settings.registry', id: 'singleton' }, propertyIds: ['interface.theme_tone'] }) } }] }
        for (const item of [{ delta, finish_reason: null }, { delta: {}, finish_reason: called ? 'stop' : 'tool_calls' }]) {
          response.write(`data: ${JSON.stringify({ id: 'fixture-reply', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, ...item }] })}\n\n`)
        }
        response.end('data: [DONE]\n\n')
      })
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        await page.evaluate(async (baseUrl) => {
          const baselineConfig = await window.henjiNative.llm.readConfig() ?? { providers: [], models: [], promptProfiles: [], agentProfiles: [] }
          const provider = { providerId: 'pi-reality', displayName: '隔离验收', adapter: 'openai-compatible', baseUrl, enabled: true, setup: { kind: 'custom' } }
          const model = { providerId: provider.providerId, modelId: 'fixture', displayName: '隔离验收模型', adapter: provider.adapter, baseUrl, enabled: true,
            capabilities: { text: true, image: false, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false,
              jsonOutput: false, structuredOutputMode: 'none', reasoning: false, sampling: true, contextWindow: 32768, maxOutputTokens: 1024, usage: true } }
          const image = { ...model, modelId: 'fixture-image', displayName: '图片验收模型', capabilities: { ...model.capabilities, image: true } }
          const media = { ...model, modelId: 'fixture-media', displayName: '媒体验收模型', capabilities: { ...model.capabilities, image: true, video: true, audio: true } }
          await window.henjiNative.llm.commitProviderSettings({ provider, seedModels: [model, image, media], baselineConfig, credential: { kind: 'set', apiKey: 'reality-fixture-key' } })
        }, `http://127.0.0.1:${server.address().port}/v1`)
        await page.keyboard.press('Control+Shift+A')
        const panel = page.getByRole('complementary', { name: '智能助手' })
        await panel.waitFor()
        await page.getByRole('button', { name: '助手操作权限', exact: true }).click()
        await page.getByRole('option', { name: '仅查看', exact: true }).click()
        const editor = page.getByRole('textbox', { name: '向智能助手描述任务' })
        await editor.fill('验收读取主题')
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await panel.getByText('已读取当前主题设置。', { exact: true }).waitFor({ timeout: 60000 })
        await page.getByRole('button', { name: '发送', exact: true }).waitFor()
        assert.equal(requests.length, 2)
        assert.ok(requests[0].tools.some((tool) => tool.function.name === 'read_application_entity'))
        for (const name of ['bash', 'read', 'write', 'edit', 'change_application_entities', 'create_visible_generation_task']) {
          assert.equal(requests[0].tools.some((tool) => tool.function.name === name), false, `只读助手不应获得 ${name}`)
        }
        const toolResult = JSON.parse(requests[1].messages.find((message) => message.role === 'tool').content)
        assert.equal(toolResult.isError, false, JSON.stringify(toolResult))
        assert.equal(toolResult.structuredContent.ok, true, JSON.stringify(toolResult))
        assert.equal((await page.evaluate(() => window.henjiNative.mcp.status())).enabled, false)
        const before = await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())
        assert.equal(before.error, null)
        await page.getByRole('button', { name: '新建对话', exact: true }).click()
        await panel.getByText('从当前工作开始', { exact: true }).waitFor()
        await page.getByRole('button', { name: '对话历史', exact: true }).click()
        await panel.getByRole('button', { name: /验收读取主题/ }).click()
        await panel.getByText('已读取当前主题设置。', { exact: true }).waitFor()
        assert.equal((await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())).sessionId, before.sessionId)
        await page.reload()
        await page.getByRole('complementary', { name: '智能助手' }).waitFor()
        await page.getByText('已读取当前主题设置。', { exact: true }).waitFor()
        waiting = true
        await page.getByRole('textbox', { name: '向智能助手描述任务' }).fill('验收停止')
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await page.waitForFunction(async () => (await window.henjiNative.embeddedAgent.snapshot()).busy)
        await page.getByRole('button', { name: '停止', exact: true }).click()
        await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 15000 })
        assert.equal((await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())).busy, false)
        await page.getByRole('button', { name: '新建对话', exact: true }).click()
        await page.getByText('从当前工作开始', { exact: true }).waitFor()
        waiting = false
        assert.equal(await page.getByRole('button', { name: /^添加图片/ }).count(), 0, '文本模型不能展示上传入口')
        const selectModel = async (name) => {
          await page.getByRole('button', { name: '助手模型', exact: true }).click()
          await page.getByRole('option', { name: `${name} · 隔离验收`, exact: true }).click()
          await page.getByRole('option', { name: `${name} · 隔离验收`, exact: true }).waitFor({ state: 'detached' })
        }
        await selectModel('图片验收模型')
        await page.getByRole('button', { name: '添加图片', exact: true }).waitFor()
        assert.equal(await page.getByLabel('聊天附件', { exact: true }).getAttribute('accept'), '.png,.jpg,.jpeg,.webp,.gif')
        await page.getByLabel('聊天附件', { exact: true }).setInputFiles(path.resolve('resources/icons/icon.png'))
        await page.getByRole('button', { name: '移除 icon.png', exact: true }).waitFor()
        await selectModel('隔离验收模型')
        await page.getByText('当前模型无法读取部分附件，请移除这些附件或切换模型。', { exact: true }).waitFor()
        assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true)
        await selectModel('图片验收模型')
        await page.getByRole('button', { name: '移除 icon.png', exact: true }).click()
        // 正式内部拖拽协议，复用刚保存的素材，不能再次上传复制同一份数据。
        const assetsBefore = await page.evaluate(() => window.henjiNative.assetLibrary.queryAssets({ keyword: 'icon.png' }))
        const asset = assetsBefore.items[0]
        assert.ok(asset)
        await page.getByLabel('聊天输入区', { exact: true }).evaluate((element, asset) => {
          const transfer = new DataTransfer()
          transfer.setData('application/x-henji-drag-data', JSON.stringify({ type: 'image', imageUrl: asset.displayUrl, filePath: asset.filePath, sourceType: 'asset', assetId: asset.id, displayName: asset.displayName }))
          element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
        }, asset)
        await page.getByRole('button', { name: '移除 icon.png', exact: true }).waitFor()
        const assetsAfter = await page.evaluate(() => window.henjiNative.assetLibrary.queryAssets({ keyword: 'icon.png' }))
        assert.equal(assetsAfter.total, assetsBefore.total)
        const requestStart = requests.length
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 })
        assert.ok(requests.length > requestStart)
        const user = requests[requestStart].messages.find((message) => message.role === 'user' && Array.isArray(message.content) && message.content.some((part) => part.type === 'image_url'))
        assert.ok(user, '图片必须实际到达模型请求')
        assert.ok(user.content.find((part) => part.type === 'image_url').image_url.url.startsWith('data:image/png;base64,'))
        const snapshot = await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())
        assert.equal(snapshot.error, null)
        assert.equal(snapshot.messages[0].attachments[0].mediaRef, `asset:${asset.id}`)
        await page.reload()
        await panel.getByRole('img', { name: 'icon.png', exact: true }).waitFor()
        await selectModel('媒体验收模型')
        await page.getByRole('button', { name: '添加图片、视频、音频', exact: true }).waitFor()
        assert.equal(await page.getByLabel('聊天附件', { exact: true }).getAttribute('accept'), '.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov,.mp3,.wav')
        await context.seedAndOpenCanvasPanoramaProject(page)
        if (!await panel.isVisible()) await page.keyboard.press('Control+Shift+A')
        await selectModel('图片验收模型')
        const node = page.locator('.react-flow__node[data-id="__ui_panorama_source"]')
        await node.click()
        await editor.fill('@')
        const candidate = page.getByRole('option', { name: '本地全景参考图', exact: true })
        await candidate.waitFor()
        assert.equal(await page.getByRole('listbox', { name: '媒体引用候选' }).getByRole('option').count(), 1)
        await candidate.click()
        const remove = panel.getByRole('button', { name: '移除 本地全景参考图', exact: true })
        await remove.waitFor()
        await remove.click()
        await editor.fill('')
        const positionBefore = await node.getAttribute('style')
        await page.getByRole('button', { name: '拖动素材 本地全景参考图', exact: true }).dragTo(page.getByLabel('聊天输入区', { exact: true }))
        await remove.waitFor()
        assert.equal(await node.getAttribute('style'), positionBefore, '素材拖出不能移动节点')
        await remove.click()
        const bounds = await node.boundingBox()
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await page.mouse.down()
        await page.mouse.move(bounds.x + bounds.width / 2 + 35, bounds.y + bounds.height / 2 + 20, { steps: 12 })
        await page.mouse.up()
        assert.notEqual(await node.getAttribute('style'), positionBefore, '节点原有移动仍应生效')
        await editor.fill('@')
        await candidate.waitFor()
      } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
    },
  }]
}
module.exports = { createEmbeddedAgentScenes }
