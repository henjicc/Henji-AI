const assert = require('node:assert/strict')
const { createServer } = require('node:http')
const path = require('node:path')
const { authorizeMcpConnection, connectMcpClient, callTool } = require('./uiInspectionMcpClient.cjs')

// 官方 Pi + 真实 utility process / preload / 应用工具；只用本地模型响应替身，不访问外部模型。
function createEmbeddedAgentScenes(context) {
  const scene = (conversationOnly) => ({ id: conversationOnly ? 'embedded-agent-conversation' : 'embedded-agent', surface: '助手',
    name: conversationOnly ? '内置助手-消息过程与结论' : '内置助手-对话工具停止与恢复', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const waitSnapshot = async (predicate) => {
        const deadline = Date.now() + 15000
        while (Date.now() < deadline) {
          const value = await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())
          if (predicate(value)) return value
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        throw new Error('助手状态未在时限内到达预期')
      }
      const requests = []
      let waiting = false
      let canvasGeneration = false
      let releaseFirst
      let releaseAnswer
      const server = createServer(async (request, response) => {
        const chunks = []
        for await (const chunk of request) chunks.push(Buffer.from(chunk))
        const body = JSON.parse(Buffer.concat(chunks).toString())
        requests.push(body)
        response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders()
        if (waiting) return
        if (requests.length === 1) {
          response.write(`data: ${JSON.stringify({ id: 'fixture-thinking', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: { reasoning_content: '先查看当前主题，再核对设置。' }, finish_reason: null }] })}\n\n`)
          await new Promise(resolve => { releaseFirst = resolve })
        } else if (requests.length === 2) await new Promise(resolve => { releaseAnswer = resolve })
        const called = body.messages.some((message) => message.role === 'tool')
        const delta = canvasGeneration ? (called ? { content: '画布生成任务已提交。' } : { tool_calls: [{ index: 0, id: 'call_canvas_generation', type: 'function',
          function: { name: 'create_visible_generation_task', arguments: JSON.stringify({ operationId: require('node:crypto').randomUUID(), modelId: 'kie-gpt-image-2.5', prompt: '画布节点生成验收', mediaType: 'image', params: {} }) } }] }) : called ? { content: '已读取当前主题设置。' } : { tool_calls: [{ index: 0, id: 'call_read_theme', type: 'function',
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
          const config = await window.henjiNative.llm.readConfig()
          config.agentProfiles = [{ id: 'pi-fixture-profile', name: '验收助手', primary: { providerId: 'pi-reality', modelId: 'fixture' },
            settings: { timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 1024, contextWindowBudget: 32768 },
            verifications: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
          config.selectedAgentProfileId = 'pi-fixture-profile'
          await window.henjiNative.llm.writeConfig(config)
        }, `http://127.0.0.1:${server.address().port}/v1`)
        await page.keyboard.press('Control+Shift+A')
        const panel = page.getByRole('complementary', { name: '智能助手' })
        await panel.waitFor()
        assert.equal(await panel.getByRole('button', { name: '助手模型', exact: true }).count(), 0)
        assert.ok((await page.getByRole('button', { name: '助手操作权限', exact: true }).textContent()).includes('完全访问'))
        await page.evaluate(async () => { const state = await window.henjiNative.mcp.status(); await window.henjiNative.mcp.configure({ enabled: false, port: state.port }) })
        await page.getByRole('button', { name: '助手操作权限', exact: true }).click()
        await page.getByRole('option', { name: '只读访问', exact: true }).click()
        await page.reload()
        await panel.waitFor()
        assert.ok((await page.getByRole('button', { name: '助手操作权限', exact: true }).textContent()).includes('只读访问'))
        const editor = page.getByRole('textbox', { name: '向智能助手描述任务' })
        console.log('[embedded-agent] 读取主题', await page.evaluate(() => window.henjiNative.embeddedAgent.models()))
        await editor.fill('验收读取主题')
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await panel.locator('[data-embedded-user-message]').getByText('验收读取主题', { exact: true }).waitFor()
        assert.equal(await panel.getByText('正在准备…', { exact: true }).count(), 0)
        await panel.getByRole('button', { name: '正在思考', exact: true }).waitFor({ timeout: 60000 })
        assert.equal(await panel.getByText('先查看当前主题，再核对设置。', { exact: true }).count(), 0)
        await capture('conversation-thinking')
        await panel.getByRole('button', { name: '正在思考', exact: true }).click()
        await panel.getByText('先查看当前主题，再核对设置。', { exact: true }).waitFor()
        await panel.getByRole('button', { name: '正在思考', exact: true }).click()
        releaseFirst()
        await waitSnapshot(value => typeof releaseAnswer === 'function' && value.messages.some(message => message.kind === 'tool' && message.status === 'completed'))
        await capture('conversation-tools')
        assert.equal(typeof releaseAnswer, 'function')
        releaseAnswer()
        await panel.getByText('已读取当前主题设置。', { exact: true }).waitFor({ timeout: 60000 })
        assert.equal(await panel.locator('[data-embedded-process]').count(), 0)
        await capture('conversation-answer')
        await panel.getByRole('button', { name: '查看过程', exact: true }).click()
        await panel.getByRole('button', { name: '思考过程', exact: true }).click()
        await panel.getByText('先查看当前主题，再核对设置。', { exact: true }).waitFor()
        await panel.getByRole('button', { name: '查看过程', exact: true }).click()
        await page.getByRole('button', { name: '发送', exact: true }).waitFor()
        assert.equal(requests.length, 2)
        assert.ok(requests[0].tools.some((tool) => tool.function.name === 'read_application_entity'))
        for (const name of ['bash', 'read', 'write', 'edit', 'change_application_entities', 'create_visible_generation_task']) {
          assert.equal(requests[0].tools.some((tool) => tool.function.name === name), false, `只读助手不应获得 ${name}`)
        }
        const toolResult = JSON.parse(requests[1].messages.find((message) => message.role === 'tool').content)
        assert.equal(toolResult.ok, true, JSON.stringify(toolResult))
        assert.equal(typeof toolResult.data.properties['interface.theme_tone'], 'string', JSON.stringify(toolResult))
        assert.equal(Object.hasOwn(toolResult, 'structuredContent'), false, 'Pi 回执不应重复携带 MCP 镜像')
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
        await waitSnapshot(value => value.busy)
        await page.waitForFunction(() => document.querySelector('[aria-label="向智能助手描述任务"]').textContent === '')
        await editor.fill('等待队列消息')
        await page.getByRole('button', { name: '等待发送', exact: true }).click()
        await waitSnapshot(value => value.pendingMessages.some(item => item.text === '等待队列消息'))
        await page.screenshot({ path: path.resolve('.ui-tour/embedded-agent-queue.png') })
        assert.equal(await editor.textContent(), '')
        await page.getByRole('button', { name: '发送方式', exact: true }).click()
        await page.getByRole('option', { name: '打断', exact: true }).click()
        await editor.fill('优先插入消息')
        waiting = false
        await page.getByRole('button', { name: '打断发送', exact: true }).click()
        await waitSnapshot(value => !value.busy && value.messages.some(item => item.role === 'user' && item.text === '等待队列消息'))
        const ordered = (await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())).messages.filter(item => item.role === 'user').map(item => item.text)
        assert.deepEqual(ordered.slice(-3), ['验收停止', '优先插入消息', '等待队列消息'])
        waiting = true
        console.log('[embedded-agent] 等待与打断')
        await editor.fill('单独停止')
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await waitSnapshot(value => value.busy)
        await page.getByRole('button', { name: '停止', exact: true }).click()
        await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 15000 })
        assert.equal((await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())).busy, false)
        await panel.getByText('单独停止', { exact: true }).waitFor()
        if (conversationOnly) return
        await page.getByRole('button', { name: '新建对话', exact: true }).click()
        await page.getByText('从当前工作开始', { exact: true }).waitFor()
        waiting = false
        assert.equal(await page.getByRole('button', { name: /^添加图片/ }).count(), 0, '文本模型不能展示上传入口')
        const selectModel = async (name) => {
          console.log('[embedded-agent] 设置主模型', name)
          await page.evaluate(async name => {
            const config = await window.henjiNative.llm.readConfig()
            const model = config.models.find(item => item.displayName === name)
            config.agentProfiles = config.agentProfiles.map(profile => ({ ...profile, primary: { providerId: model.providerId, modelId: model.modelId } }))
            await window.henjiNative.llm.writeConfig(config)
          }, name)
          await page.getByRole('button', { name: /^(设置|Settings)$/i }).click()
          await page.getByRole('dialog', { name: /设置|Settings/i }).waitFor()
          await page.keyboard.press('Escape')
          await panel.waitFor()
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
        await page.getByRole('button', { name: '助手操作权限', exact: true }).click()
        await page.getByRole('option', { name: '完全访问', exact: true }).click()
        const requestStart = requests.length
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await page.getByRole('button', { name: '发送', exact: true }).waitFor({ timeout: 60000 })
        assert.ok(requests.length > requestStart)
        assert.ok(requests[requestStart].tools.some(tool => tool.function.name === 'create_visible_generation_task'), '开放权限后生成工具必须送到模型')
        console.log('[embedded-agent] 首轮工具数量与定义字符数', requests[requestStart].tools.length, JSON.stringify(requests[requestStart].tools).length)
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
        assert.equal(await page.getByRole('button', { name: /^拖动素材/ }).count(), 0)
        const sourceBounds = await node.boundingBox()
        const destination = await page.getByLabel('聊天输入区', { exact: true }).boundingBox()
        await page.keyboard.down('Shift')
        await page.mouse.move(sourceBounds.x + 30, sourceBounds.y + 40)
        await page.mouse.down()
        await page.mouse.move(destination.x + 80, destination.y + 30, { steps: 18 })
        await page.mouse.up()
        await page.keyboard.up('Shift')
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
        // 生成替身只放在 IPC 之后；真实助手工具、参数准备、标准节点挂载、请求构建与结果提交全部照常走。
        await app.evaluate(({ ipcMain }, resultPath) => {
          ipcMain.removeHandler('ai:generate')
          ipcMain.handle('ai:generate', async (_event, request) => {
            globalThis.__canvasGenerationRequest = request
            await new Promise(resolve => { globalThis.__finishCanvasGeneration = resolve })
            return { ok: true, data: { status: 'completed', url: resultPath, filePath: resultPath } }
          })
        }, path.resolve('resources/icons/icon.png'))
        await page.evaluate(() => window.henjiNative.ai.setProviderApiKey('kie', 'isolated-generation-fixture'))
        await page.reload()
        const { projectId } = await context.seedAndOpenCanvasPanoramaProject(page)
        if (!await panel.isVisible()) await page.keyboard.press('Control+Shift+A')
        await page.getByRole('button', { name: '新建对话', exact: true }).click()
        await panel.getByText('从当前工作开始', { exact: true }).waitFor()
        await page.locator('.react-flow__node[data-id="__ui_panorama_source"]').click()
        canvasGeneration = true
        await editor.fill('画布生成验收：在选中参考图旁生成图片')
        await page.getByRole('button', { name: '发送', exact: true }).click()
        const deadline = Date.now() + 20000
        while (!await app.evaluate(() => Boolean(globalThis.__canvasGenerationRequest))) {
          if (Date.now() > deadline) throw new Error('标准画布节点未发出生成请求：' + JSON.stringify(await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())))
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        const generatedRequest = await app.evaluate(() => globalThis.__canvasGenerationRequest)
        assert.equal(generatedRequest.modelId, 'kie-gpt-image-2.5')
        assert.equal(generatedRequest.params.images.length, 1, '同一参考图的连线与本地引用不能重复发送')
        await capture('canvas-generating')
        await app.evaluate(() => globalThis.__finishCanvasGeneration())
        let persisted
        const resultDeadline = Date.now() + 15000
        do {
          persisted = await page.evaluate(async id => {
            const record = await window.henjiNative.storyboardProjects.getProjectRecord(id)
            return { nodes: JSON.parse(record.nodesJson), edges: JSON.parse(record.edgesJson) }
          }, projectId)
          if (persisted.nodes.some(item => item.data.generationSourceNodeId && item.data.imageUrl && !item.data.isGenerating)) break
          if (Date.now() > resultDeadline) throw new Error('画布生成结果未保存')
          await new Promise(resolve => setTimeout(resolve, 100))
        } while (true)
        const generator = persisted.nodes.find(item => item.type === 'imageNode' && item.data.prompt === '画布节点生成验收')
        assert.ok(generator, '必须保留真实的标准生成节点')
        assert.ok(persisted.edges.some(edge => edge.source === '__ui_panorama_source' && edge.target === generator.id), '参考图必须连接生成节点')
        const result = persisted.nodes.find(item => item.data.generationSourceNodeId === generator.id && item.data.imageUrl)
        assert.ok(result)
        assert.ok(persisted.edges.some(edge => edge.source === generator.id && edge.target === result.id), '结果必须连在生成节点后')
        await capture('canvas-completed')
        // 真实节点按钮再次生成：验证 UI 与 MCP 读取的是同一份 SQLite 任务。
        await page.keyboard.press('Control+Shift+A')
        await page.waitForFunction(async taskId => {
          const rows = await window.henjiNative.db.select('SELECT status FROM history WHERE id=?', [taskId])
          return rows[0]?.status === 'success'
        }, generatedRequest.requestId)
        await app.evaluate(() => { globalThis.__canvasGenerationRequest = null })
        const generatorNode = page.locator(`.react-flow__node[data-id="${generator.id}"]`)
        await generatorNode.click({ position: { x: 3, y: 3 } })
        await page.locator(`.react-flow__node[data-id="${generator.id}"].selected`).waitFor()
        await page.locator(`.react-flow__node-toolbar[data-id="${generator.id}"]`).getByRole('button', { name: '生成', exact: true }).click()
        const uiDeadline = Date.now() + 15000
        while (!await app.evaluate(() => Boolean(globalThis.__canvasGenerationRequest))) {
          if (Date.now() > uiDeadline) {
            await capture('ui-task-stalled')
            const diagnostics = await page.evaluate(async () => ({
              history: await window.henjiNative.db.select('SELECT id,status,params FROM history'),
              logs: await window.henjiNative.logging.queryLogEvents({ date: new Date().toISOString().slice(0, 10), domainPrefix: 'features.canvas', limit: 25 }),
            }))
            throw new Error('界面生成按钮没有发出正式请求：' + JSON.stringify(diagnostics))
          }
          await page.waitForTimeout(100)
        }
        const uiRequest = await app.evaluate(() => globalThis.__canvasGenerationRequest)
        const uiTaskId = uiRequest.requestId
        assert.ok(uiTaskId && uiTaskId !== generatedRequest.requestId, '界面新请求必须有独立任务标识')
        const rows = await page.evaluate(() => window.henjiNative.db.select('SELECT id,status,params FROM history'))
        assert.equal(rows.filter(row => row.id === uiTaskId).length, 1, '界面生成只能登记一条历史')
        const storedTask = rows.find(row => row.id === uiTaskId)
        assert.equal(JSON.parse(storedTask.params).__canvasGeneration.projectId, projectId)
        assert.equal(JSON.parse(storedTask.params).__canvasGeneration.nodeId, generator.id)
        const identity = await authorizeMcpConnection(page, { name: '界面任务只读验收' })
        const client = await connectMcpClient(identity.config, 'Henji UI generation task')
        try {
          const pending = await callTool(client, 'get_generation_task', { taskId: uiTaskId })
          assert.equal(pending.data.task.waitingExternal, true)
          assert.equal(pending.data.task.cancellable, true)
          await app.evaluate(() => globalThis.__finishCanvasGeneration())
          const completedDeadline = Date.now() + 15000
          let task
          do {
            task = (await callTool(client, 'get_generation_task', { taskId: uiTaskId })).data.task
            if (task.resultAvailable) break
            if (Date.now() > completedDeadline) throw new Error('界面任务未通过 MCP 确认完成：' + JSON.stringify(task))
            await page.waitForTimeout(100)
          } while (true)
          assert.equal(task.status, 'success')
          assert.equal(task.cancellable, false)
          const saved = await page.evaluate(async ({ projectId, taskId }) => {
            const project = await window.henjiNative.storyboardProjects.getProjectRecord(projectId)
            const rows = await window.henjiNative.db.select('SELECT status,file_path FROM history WHERE id=?', [taskId])
            return { history: rows[0], imagePool: JSON.parse(project.historyJson).imagePool,
              results: JSON.parse(project.nodesJson).filter(node => node.data.generationTaskId === taskId) }
          }, { projectId, taskId: uiTaskId })
          assert.equal(saved.history.status, 'success')
          assert.equal(saved.results.length, 1)
          const imageRef = saved.results[0].data.imageUrl
          assert.match(imageRef, /^__img_ref__:\d+$/)
          assert.equal(saved.imagePool[Number(imageRef.slice('__img_ref__:'.length))], saved.history.file_path)
          assert.equal(saved.results[0].data.isGenerating, false)
          await capture('ui-task-completed')
        } finally { await client.close() }
      } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) }
    },
  })
  return [scene(false), scene(true)]
}
module.exports = { createEmbeddedAgentScenes }
