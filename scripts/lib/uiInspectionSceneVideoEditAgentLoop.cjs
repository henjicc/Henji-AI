const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createServer } = require('node:http')
const sharp = require('sharp')
const { authorizeMcpConnection, callTool, connectMcpClient, disableMcp, expectToolRefusal, operationEnvelope, readAllMedia } = require('./uiInspectionMcpClient.cjs')
const { observeWorkers, workerSnapshot, waitReleased } = require('./uiInspectionSceneVideoEditLayout.cjs')
const { dialogs, presented } = require('./uiInspectionSceneVideoEditMonitor.cjs')
const { leaveVideoEditProject, openVideoEditProjectCard, readVideoEditFile, seedVideoEditProject, showVideoEditProjects } = require('./uiInspectionVideoEditDocuments.cjs')
const button = (page, name) => page.getByRole('button', { name, exact: true })
const ORIGINAL = 'D:/视频制作/0A0片头片尾和素材/2021片头V2 4K 60FPS.mp4'
const FIXTURE_ID = 'video-edit-agent-loop'
// Original source written for this acceptance: not a template parameter change.
const SOURCE = 'export default {apiVersion:1,name:"智能体原创色块",kind:"generator",mode:"static",width:3840,height:2160,durationSeconds:5,seed:3,parameters:{red:{type:"number",title:"红色",default:.2,min:0,max:1,step:.01,animatable:true}},render(ctx){return [rect({x:960,y:540,width:1920,height:1080,fill:[ctx.params.red,.3,.8,1]})];}}'

function fixture() {
  const track = (index, kind, name) => ({ id: `${kind[0]}${index}`, name, index, kind, locked: false, enabled: true, muted: false, solo: false })
  return { format: 'henji-video-project', version: 2, id: FIXTURE_ID, name: '智能体剪辑回环', revision: 0,
    media: [{ id: 'original', name: '原4K60片头', path: ORIGINAL, kind: 'video', durationSeconds: 7, width: 3840, height: 2160, hasAudio: false, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' }],
    bins: [], items: [{ id: 'original-item', name: '原4K60片头', kind: 'video', mediaId: 'original' }],
    sequences: [{ id: 'main', name: '序列 1', width: 3840, height: 2160, frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 1, denominator: 1 }, sampleRate: 48000, channels: 2,
      tracks: [track(0, 'audio', '音频 1'), track(1, 'video', '视频 1'), track(2, 'video', '视频 2')],
      clips: [{ id: 'base', itemId: 'original-item', name: '原4K60片头', kind: 'video', track: 1, start: 0, duration: 420, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, brightness: 1, text: '' }], annotations: [] }] }
}
// 3.1：剪辑是项目里的文档文件，按旧工程形状读出（项目内相对写法换回绝对路径）
const readProject = readVideoEditFile
async function centerPixel(bytes) {
  const image = sharp(bytes); const { width, height } = await image.metadata()
  const { data } = await image.extract({ left: Math.floor(width / 2), top: Math.floor(height / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { width, height, rgb: [...data] }
}
const near = (rgb, expected, tolerance = 4) => rgb.every((value, index) => Math.abs(value - expected[index]) <= tolerance)

/** Real Modern MCP and the real built-in Pi (local scripted model, no paid call) drive one shared project. */
function createVideoEditAgentLoopScene() {
  return { id: 'video-edit-agent-loop', surface: '剪辑', name: '剪辑-MCP与Pi原创代码素材创作调参观察撤销保存回环', writesUserData: true,
    setup: async (page, app, { capture }) => {
      const root = path.resolve('node_modules/.cache/video-edit-agent-loop'); fs.rmSync(root, { recursive: true, force: true }); fs.mkdirSync(root, { recursive: true })
      // 3.1：经正式文档接口建项目与主剪辑，文档 ID 由仓库生成
      let file; let seeded; let PROJECT_ID = FIXTURE_ID
      const evidence = { completed: false, phases: [], captures: [], timings: {}, pi: {} }
      const store = () => fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      const phase = name => { evidence.currentPhase = name; store() }
      const shot = async name => { evidence.captures.push({ name, result: await capture(name) }); store() }
      const projectRef = { kind: 'video_edit.project', id: PROJECT_ID }
      const sequenceRef = { kind: 'video_edit.sequence', id: `${PROJECT_ID}:main` }
      let client; let observed = false; let server
      const observe = async (target, maxWidth = 960) => {
        // Read-only observation: no operation envelope or baseline, same as other read tools.
        const at = performance.now()
        const result = await callTool(client, 'observe_video_edit_frame', { projectRef, target, maxWidth })
        const data = result.result?.data ?? result.data
        assert.equal(data?.verification?.verified, true, JSON.stringify(result))
        const media = await readAllMedia(client, data.resultRef)
        return { elapsedMs: performance.now() - at, data, mimeType: media.mimeType, pixel: await centerPixel(media.bytes) }
      }
      try {
        phase('open-project')
        await showVideoEditProjects(page)
        seeded = await seedVideoEditProject(page, fixture()); file = seeded.file; PROJECT_ID = seeded.documentId
        projectRef.id = PROJECT_ID; sequenceRef.id = `${PROJECT_ID}:main`
        await observeWorkers(page); observed = true
        await openVideoEditProjectCard(page, seeded.projectId); await presented(page, 0)
        const identity = await authorizeMcpConnection(page, { name: '智能体剪辑回环', allowWrites: true }); client = await connectMcpClient(identity.config, 'Henji agent loop Reality')

        phase('mcp-discover')
        const tools = (await client.listTools()).tools.map(tool => tool.name)
        evidence.mcpTools = tools.filter(name => /video_edit|application_entit|application_media|application_contract/.test(name))
        for (const name of ['observe_video_edit_frame', 'change_application_entities', 'read_application_media']) assert.ok(tools.includes(name), `MCP 目录缺少 ${name}`)
        const contract = await callTool(client, 'describe_application_contract', { domains: ['video_edit'] })
        const entityIds = (contract.data.domains.find(domain => domain.id === 'video_edit')?.entities ?? []).map(entity => entity.id ?? entity.entityType)
        evidence.contractEntities = entityIds
        for (const entity of ['video_edit.code_material', 'video_edit.clip', 'video_edit.sequence']) assert.ok(entityIds.includes(entity), `契约缺少 ${entity}：${JSON.stringify(entityIds)}`)

        phase('mcp-skill')
        // A history-free external client discovers and reads the same runtime skill through ordinary tools.
        const fullContract = await callTool(client, 'describe_application_contract', {})
        evidence.skillIndex = fullContract.data.skills
        assert.ok(JSON.stringify(fullContract.data.skills ?? []).includes('video-edit-code-creation'), `契约技能段缺少剪辑创作技能：${JSON.stringify(fullContract.data.skills)}`)
        const skill = await callTool(client, 'load_assistant_skill', { name: 'video-edit-code-creation', reason: '编写剪辑原生代码素材' })
        const reference = await callTool(client, 'load_assistant_skill', { name: 'video-edit-code-creation', path: 'references/author-api.md', reason: '查作者接口' })
        const skillText = JSON.stringify(skill); const referenceText = JSON.stringify(reference)
        assert.ok(skillText.includes('剪辑代码素材创作'), '技能正文应可读取'); assert.ok(referenceText.includes('rect'), '作者接口参考应可读取')
        evidence.skillBytes = { main: Buffer.byteLength(skillText), reference: Buffer.byteLength(referenceText) }
        evidence.skillRefusal = await expectToolRefusal(client, 'load_assistant_skill', { name: 'video-edit-code-creation', path: '../../../package.json', reason: '越界验收' })
        evidence.phases.push('外部MCP从契约技能段发现剪辑创作技能，读取正文与一份参考，越界路径被拒绝')

        phase('mcp-author-insert')
        let at = performance.now()
        const baseline = await callTool(client, 'read_application_entity', { ref: projectRef })
        const created = await callTool(client, 'change_application_entities', operationEnvelope([baseline], { summary: '编写原创色块代码素材', changes: [{ kind: 'create_items', entityType: 'video_edit.code_material', parent: projectRef, items: [{ properties: { 'video_edit.code_material.source': SOURCE } }] }] }))
        assert.equal(created.verificationState, 'verified', JSON.stringify(created)); evidence.timings.authorMs = performance.now() - at
        const authored = readProject(file); const item = authored.items.find(value => value.kind === 'code'); assert.ok(item, '应生成真实代码项目项')
        assert.equal(authored.codeMaterials[0].versions[0].source, SOURCE)
        const seqRead = await callTool(client, 'read_application_entity', { ref: sequenceRef })
        const inserted = await callTool(client, 'change_application_entities', operationEnvelope([seqRead], { summary: '插入原创色块', changes: [{ kind: 'create_items', entityType: 'video_edit.clip', parent: sequenceRef, items: [{ properties: { 'video_edit.clip.item_id': item.id, 'video_edit.clip.name': '原创色块', 'video_edit.clip.kind': 'code', 'video_edit.clip.track': 2, 'video_edit.clip.start': 0, 'video_edit.clip.duration': 120 } }] }] }))
        assert.equal(inserted.verificationState, 'verified', JSON.stringify(inserted))
        const clip = readProject(file).sequences[0].clips.find(value => value.kind === 'code'); assert.ok(clip)
        const clipRef = { kind: 'video_edit.clip', id: `${PROJECT_ID}:${clip.id}` }
        evidence.clipRef = clipRef

        phase('mcp-observe-parameter')
        const first = await observe({ kind: 'program', sequenceRef, frame: 60 })
        assert.equal(first.mimeType, 'image/png'); assert.deepEqual([first.pixel.width, first.pixel.height], [960, 540])
        assert.ok(near(first.pixel.rgb, [51, 77, 204]), `默认红色0.2的合成帧中心像素不符：${first.pixel.rgb}`)
        const clipRead = await callTool(client, 'read_application_entity', { ref: clipRef })
        at = performance.now()
        const changed = await callTool(client, 'change_application_entities', operationEnvelope([clipRead], { summary: '红色调到0.9', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.code_parameters': { red: 0.9 } } }] }))
        assert.equal(changed.verificationState, 'verified', JSON.stringify(changed)); evidence.timings.parameterChangeMs = performance.now() - at
        const second = await observe({ kind: 'program', sequenceRef, frame: 60 })
        assert.ok(near(second.pixel.rgb, [230, 77, 204]), `调参后合成帧中心像素不符：${second.pixel.rgb}`)
        const source = await observe({ kind: 'source', itemRef: { kind: 'video_edit.item', id: `${PROJECT_ID}:original-item` }, timeUs: 4_000_000 })
        assert.deepEqual([source.data.sourceWidth, source.data.sourceHeight], [3840, 2160])
        assert.ok(!near(source.pixel.rgb, [230, 77, 204], 20), '源帧必须是原素材画面，不能是合成结果')
        evidence.observations = { first, second, source: { ...source, pixel: source.pixel } }
        assert.equal(await page.evaluate(() => document.querySelector('canvas[aria-label="剪辑画面"]')?.dataset.presentedFrame), '0', '观察不得移动用户播放头')
        evidence.phases.push('MCP发现契约→编写原创源码→插入→观察合成帧(960×540中心像素)→调参→再观察→源帧观察，播放头不变')

        phase('permission')
        // A read-only connection may observe but never write; the refusal must leave the saved project untouched.
        const readOnly = await authorizeMcpConnection(page, { name: '只读剪辑观察', allowWrites: false }); const viewer = await connectMcpClient(readOnly.config, 'Henji read-only viewer')
        try {
          const before = JSON.stringify(readVideoEditFile(file))
          const viewed = await callTool(viewer, 'observe_video_edit_frame', { projectRef, target: { kind: 'program', sequenceRef, frame: 60 }, maxWidth: 256 })
          assert.equal((viewed.result?.data ?? viewed.data).verification.verified, true)
          const readClip = await callTool(viewer, 'read_application_entity', { ref: clipRef })
          evidence.readOnlyRefusal = await expectToolRefusal(viewer, 'change_application_entities', operationEnvelope([readClip], { summary: '只读连接越权调参', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.code_parameters': { red: 0.1 } } }] }))
          assert.equal(JSON.stringify(readVideoEditFile(file)), before, '只读连接的拒绝不得改变工程')
        } finally { await viewer.close() }
        evidence.phases.push('只读MCP连接可观察指定帧，写入被权限拒绝且工程不变')

        phase('manual-undo-save')
        await button(page, '撤销').click()
        const undone = await (async () => { for (let attempt = 0; attempt < 100; attempt++) { const value = readProject(file).sequences[0].clips.find(c => c.id === clip.id); if (value.code.parameters.red === 0.2) return value; await page.waitForTimeout(100) } throw new Error('手动撤销没有恢复 MCP 调参并静默保存') })()
        const third = await observe({ kind: 'program', sequenceRef, frame: 60 })
        assert.ok(near(third.pixel.rgb, [51, 77, 204]), `手动撤销后画面应回到默认：${third.pixel.rgb}`)
        evidence.undo = { parameters: undone.code.parameters, pixel: third.pixel.rgb }
        await shot('agent-loop-mcp-undone')
        evidence.phases.push('手动撤销撤回MCP调参，观察与保存文件一致')

        phase('pi-loop')
        const requests = []
        server = createServer(async (request, response) => {
          const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
          const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body)
          response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.flushHeaders()
          const issued = id => body.messages.some(message => Array.isArray(message.tool_calls) && message.tool_calls.some(call => call.id === id))
          const toolText = id => { const message = body.messages.find(value => value.role === 'tool' && value.tool_call_id === id); return typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? '') }
          const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] })
          let delta
          if (!issued('pi_skill')) delta = call('pi_skill', 'load_assistant_skill', { name: 'video-edit-code-creation', path: 'references/parameters-curves.md', reason: '调参数前读取参数契约' })
          else if (!issued('pi_read')) delta = call('pi_read', 'read_application_entity', { ref: clipRef, propertyIds: ['video_edit.clip.code_parameters'] })
          else if (!issued('pi_change')) delta = call('pi_change', 'change_application_entities', { operationId: require('node:crypto').randomUUID(), summary: 'Pi把红色调到0.5', changes: [{ kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.code_parameters': { red: 0.5 } } }] })
          else if (!issued('pi_observe')) delta = call('pi_observe', 'observe_video_edit_frame', { projectRef, target: { kind: 'program', sequenceRef, frame: 60 }, maxWidth: 640 })
          else if (!issued('pi_media')) {
            const assetId = /"resultRef":\{"kind":"asset","id":"([^"]+)"/.exec(toolText('pi_observe'))?.[1]
            delta = assetId ? call('pi_media', 'read_application_media', { ref: { kind: 'asset', id: assetId } }) : { content: '没有拿到观察资产。' }
          } else delta = { content: '已把原创色块红色调到0.5，并取第60帧核对画面。' }
          for (const item of [{ delta, finish_reason: null }, { delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }]) response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-image', choices: [{ index: 0, ...item }] })}\n\n`)
          response.end('data: [DONE]\n\n')
        })
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
        await page.evaluate(async baseUrl => {
          const baselineConfig = await window.henjiNative.llm.readConfig() ?? { providers: [], models: [], promptProfiles: [], agentProfiles: [] }
          const provider = { providerId: 'pi-video-edit', displayName: '剪辑验收', adapter: 'openai-compatible', baseUrl, enabled: true, setup: { kind: 'custom' } }
          const model = { providerId: provider.providerId, modelId: 'fixture-image', displayName: '剪辑验收视觉模型', adapter: provider.adapter, baseUrl, enabled: true,
            capabilities: { text: true, image: true, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false, jsonOutput: false, structuredOutputMode: 'none', reasoning: false, sampling: true, contextWindow: 65536, maxOutputTokens: 1024, usage: true } }
          await window.henjiNative.llm.commitProviderSettings({ provider, seedModels: [model], baselineConfig, credential: { kind: 'set', apiKey: 'reality-fixture-key' } })
          const config = await window.henjiNative.llm.readConfig()
          config.agentProfiles = [{ id: 'pi-video-edit-profile', name: '剪辑验收助手', primary: { providerId: 'pi-video-edit', modelId: 'fixture-image' }, settings: { timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 1024, contextWindowBudget: 65536 }, verifications: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
          config.selectedAgentProfileId = 'pi-video-edit-profile'
          await window.henjiNative.llm.writeConfig(config)
        }, `http://127.0.0.1:${server.address().port}/v1`)
        await page.keyboard.press('Control+Shift+A')
        const panel = page.getByRole('complementary', { name: '智能助手' }); await panel.waitFor()
        if ((await page.evaluate(() => window.henjiNative.embeddedAgent.snapshot())).messages.length) await page.getByRole('button', { name: '新建对话', exact: true }).click()
        at = performance.now()
        await page.getByRole('textbox', { name: '向智能助手描述任务' }).fill('把原创色块的红色调到0.5，再取第60帧检查画面')
        await page.getByRole('button', { name: '发送', exact: true }).click()
        await panel.getByText('已把原创色块红色调到0.5，并取第60帧核对画面。', { exact: true }).waitFor({ timeout: 120000 })
        evidence.timings.piLoopMs = performance.now() - at
        evidence.pi.toolResults = requests.at(-1).messages.filter(message => message.role === 'tool').map(message => ({ id: message.tool_call_id, content: (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).slice(0, 1500) })); store()
        const firstTools = requests[0].tools.map(tool => tool.function?.name ?? tool.name)
        evidence.pi.firstRoundTools = firstTools; evidence.pi.requests = requests.length
        for (const name of ['observe_video_edit_frame', 'read_application_media', 'change_application_entities', 'load_assistant_skill']) assert.ok(firstTools.includes(name), `Pi剪辑界面首轮缺少 ${name}`)
        const skillResult = evidence.pi.toolResults.find(result => result.id === 'pi_skill')
        assert.ok(skillResult && !/拒绝|不存在|未准入/.test(skillResult.content.slice(0, 200)), `Pi应能加载剪辑创作技能参考：${skillResult?.content.slice(0, 300)}`)
        assert.ok(JSON.stringify(requests[0].messages).includes('video_edit.project'), 'Pi上下文应包含剪辑宿主信息')
        const imageSeen = requests.some(body => body.messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url' || part.type === 'image')))
        assert.ok(imageSeen, 'Pi读取的观察图片应作为图像内容交给视觉模型')
        const piSaved = readProject(file).sequences[0].clips.find(value => value.id === clip.id)
        assert.equal(piSaved.code.parameters.red, 0.5, 'Pi修改应经同一工程静默保存')
        await shot('agent-loop-pi-answer')
        await page.keyboard.press('Control+Shift+A')
        await button(page, '撤销').click()
        for (let attempt = 0; attempt < 100 && readProject(file).sequences[0].clips.find(value => value.id === clip.id).code.parameters.red !== 0.2; attempt++) await page.waitForTimeout(100)
        assert.equal(readProject(file).sequences[0].clips.find(value => value.id === clip.id).code.parameters.red, 0.2, '手动撤销应撤回Pi修改')
        evidence.phases.push('真实Pi(本地受控视觉模型)以剪辑首轮工具读取→调参→观察→读取图像→结论；手动撤销撤回Pi修改')

        phase('reopen')
        await leaveVideoEditProject(page, null); await waitReleased(page)
        await openVideoEditProjectCard(page, seeded.projectId); await presented(page, 0)
        const reopened = readProject(file); assert.equal(reopened.codeMaterials[0].versions[0].source, SOURCE)
        const after = await observe({ kind: 'program', sequenceRef, frame: 60 }); assert.ok(near(after.pixel.rgb, [51, 77, 204]))
        await button(page, '关闭项目').click(); await waitReleased(page)
        evidence.resources = await workerSnapshot(page); assert.equal(evidence.resources.live, 0)
        evidence.phases.push('保存重开后源码与观察画面一致，Worker归零')
        evidence.completed = true; store()
      } catch (error) { evidence.failed = { phase: evidence.currentPhase, message: String(error.message ?? error), stack: error.stack }; store(); await shot('agent-loop-failed').catch(() => {}); throw error }
      finally {
        server?.close()
        await client?.close().catch(() => {}); await disableMcp(page).catch(() => {})
        if (await button(page, '关闭项目').isVisible().catch(() => false)) await button(page, '关闭项目').click().catch(() => {})
        if (observed) { await waitReleased(page).catch(error => { evidence.completed = false; evidence.releaseFailure = String(error) }); evidence.resources = await workerSnapshot(page).catch(() => evidence.resources) }
        await page.evaluate(() => { window.__videoLayoutObservers?.forEach(observer => observer.disconnect()); if (window.__videoLayoutNativeWorker) window.Worker = window.__videoLayoutNativeWorker }).catch(() => {}); store()
      }
    },
  }
}
module.exports = { createVideoEditAgentLoopScene }
