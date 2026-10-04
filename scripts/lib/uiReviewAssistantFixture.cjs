/**
 * 界面核对步骤的助手夹具（`seedAssistant` / `releaseAssistant` 动作）：
 * 在本机起一个 OpenAI 兼容的流式模型替身，按脚本逐轮回复（思考、工具调用、正文、HTTP 错误、暂停），
 * 写进隔离资料目录的助手模型配置。官方 Pi、utility process、preload 与应用工具全部是真的，
 * 只有“模型回复”是替身——不访问外部模型，不产生费用（与 uiInspectionSceneEmbeddedAgent.cjs 同一做法）。
 *
 * 用法见 scripts/ui-review/assistant-sidebar.json。场景结束时由 compileStepScene 调用 cleanup：
 * 放行暂停中的回复、停止助手、关闭替身、恢复进场时的模型配置，不污染同一次启动里的后续场景。
 */
const { createServer } = require('node:http')

const REPLY_KEYS = Object.freeze(['thinking', 'partial', 'content', 'tool', 'error', 'hold'])
const CAPABILITY_KEYS = Object.freeze(['image', 'video', 'audio'])

function normalizeReply(raw, index) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`replies[${index}] 必须是对象`)
  const unknown = Object.keys(raw).filter((key) => !REPLY_KEYS.includes(key))
  if (unknown.length) throw new Error(`replies[${index}] 未知字段：${unknown.join('、')}；可用 ${REPLY_KEYS.join('、')}`)
  if (raw.tool && (typeof raw.tool.name !== 'string' || !raw.tool.name)) throw new Error(`replies[${index}].tool 需要 name`)
  if (raw.tool && raw.content) throw new Error(`replies[${index}] 不能同时有 tool 与 content（一轮只产出一种收尾）`)
  if (raw.error && !(Number.isInteger(raw.error.status) && raw.error.status >= 400)) {
    throw new Error(`replies[${index}].error.status 必须是 ≥ 400 的整数`)
  }
  if (raw.hold !== undefined && typeof raw.hold !== 'boolean') throw new Error(`replies[${index}].hold 只能是布尔值`)
  return {
    thinking: raw.thinking ?? null,
    partial: raw.partial ?? null,
    content: raw.content ?? null,
    tool: raw.tool ? { name: raw.tool.name, arguments: raw.tool.arguments ?? {} } : null,
    error: raw.error ? { status: raw.error.status, message: raw.error.message ?? '替身返回错误' } : null,
    hold: raw.hold === true,
  }
}

/**
 * `seedAssistant` 参数：
 * - `replies`：按请求顺序消费的回复脚本；用完后统一回复“好的。”。每轮可含
 *   `thinking`（推理内容）、`partial`（暂停前先流出的半截正文）、`content`（正文）、
 *   `tool`（{ name, arguments }，工具调用；只用只读工具）、`error`（{ status, message }，HTTP 错误）、
 *   `hold`（true：流出 thinking/partial 后暂停，直到 `releaseAssistant`）。
 * - `capabilities`：模型额外的输入模态（image/video/audio），决定输入框是否出现附件入口。
 * - `memory`：写入共享记忆摘要（记忆面板的“已保存”状态）。
 * - `newConversation`：默认 true，先起一段干净对话，不接着前一个场景的会话。
 */
function normalizeSeedAssistant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('seedAssistant 需要对象')
  const replies = value.replies ?? []
  if (!Array.isArray(replies)) throw new Error('seedAssistant.replies 必须是数组')
  const capabilities = value.capabilities ?? []
  if (!Array.isArray(capabilities) || capabilities.some((item) => !CAPABILITY_KEYS.includes(item))) {
    throw new Error(`seedAssistant.capabilities 只能是 ${CAPABILITY_KEYS.join('、')} 的数组`)
  }
  if (value.memory !== undefined && typeof value.memory !== 'string') throw new Error('seedAssistant.memory 必须是字符串')
  return {
    replies: replies.map(normalizeReply),
    capabilities,
    memory: value.memory ?? null,
    newConversation: value.newConversation !== false,
  }
}

function chunk(delta, finishReason = null) {
  return `data: ${JSON.stringify({ id: 'review-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture',
    choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
}

/** 启动替身并写入模型配置；返回 { release, cleanup }。同一场景重复 seed 时先清理上一个。 */
async function seedAssistantFixture(page, spec) {
  // 侧栏挂载时才读取模型列表：已打开（前一个场景留下的）就先收起，让后续步骤重新打开时读到替身模型。
  const sidebar = page.locator('aside[data-application-surface-id="overlay.assistant"]')
  if (await sidebar.count()) {
    // 侧栏组件收起后不卸载，内容视图（历史 / 记忆）会保留到下次打开：先切回对话，后续步骤从对话视图开始
    const back = page.locator('aside[data-application-surface-id="overlay.assistant"] button[aria-label="返回当前对话"]:visible, '
      + 'aside[data-application-surface-id="overlay.assistant"] button[aria-label="助手记忆"][aria-pressed="true"]:visible')
    if (await back.count()) await back.first().click()
    await page.keyboard.press('Control+Shift+A')
    await sidebar.waitFor({ state: 'detached', timeout: 8000 })
  }
  const replies = [...spec.replies]
  const fixture = { held: null, requests: 0 }
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const part of request) chunks.push(Buffer.from(part))
    fixture.requests += 1
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { /* 非 JSON 请求按普通轮次处理 */ }
    const reply = replies.shift() ?? { content: '好的。' }
    // 诊断：每轮请求的形状与消费的脚本写进 .ui-tour，脚本对不上时先看这里（不记录正文）
    try {
      require('node:fs').appendFileSync(require('node:path').resolve('.ui-tour', 'assistant-fixture-requests.jsonl'), `${JSON.stringify({
        at: new Date().toISOString(), n: fixture.requests, path: request.url, tools: Array.isArray(body.tools) ? body.tools.length : 0,
        messages: Array.isArray(body.messages) ? body.messages.map((message) => message.role).join(',') : null,
        last: JSON.stringify(Array.isArray(body.messages) ? body.messages.at(-1)?.content ?? null : null).slice(0, 160),
        reply: Object.keys(reply).filter((key) => reply[key]) })}
`)
    } catch { /* 诊断写入失败不影响替身 */ }
    if (reply.error) {
      response.writeHead(reply.error.status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: reply.error.message, type: 'fixture_error' } }))
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.flushHeaders()
    if (reply.thinking) response.write(chunk({ reasoning_content: reply.thinking }))
    if (reply.partial) response.write(chunk({ content: reply.partial }))
    if (reply.hold) await new Promise((resolve) => { fixture.held = resolve })
    if (response.destroyed) return
    const delta = reply.tool
      ? { tool_calls: [{ index: 0, id: `call_review_${fixture.requests}`, type: 'function',
        function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.arguments) } }] }
      : { content: reply.content ?? (reply.partial ? '' : '好的。') }
    response.write(chunk(delta))
    response.write(chunk({}, reply.tool ? 'tool_calls' : 'stop'))
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
  const baselineConfig = await page.evaluate(async ({ baseUrl, capabilities }) => {
    const baseline = await window.henjiNative.llm.readConfig() ?? { providers: [], models: [], promptProfiles: [], agentProfiles: [] }
    const provider = { providerId: 'ui-review', displayName: '核对替身', adapter: 'openai-compatible', baseUrl, enabled: true, setup: { kind: 'custom' } }
    const model = { providerId: provider.providerId, modelId: `fixture-${capabilities.join('-') || 'text'}`, displayName: '核对替身模型', adapter: provider.adapter, baseUrl, enabled: true,
      capabilities: { text: true, image: capabilities.includes('image'), video: capabilities.includes('video'), audio: capabilities.includes('audio'),
        streaming: true, toolCall: true, parallelTools: false, jsonOutput: false, structuredOutputMode: 'none', reasoning: false, sampling: true,
        contextWindow: 32768, maxOutputTokens: 1024, usage: true } }
    await window.henjiNative.llm.commitProviderSettings({ provider, seedModels: [model], baselineConfig: baseline, credential: { kind: 'set', apiKey: 'ui-review-fixture-key' } })
    const config = await window.henjiNative.llm.readConfig()
    // 同一次启动里多个场景先后写同一个替身供应商：已有同名模型时 commit 不一定覆盖能力，这里按本场景要求写死
    config.models = (config.models ?? []).map((item) => (item.providerId === model.providerId && item.modelId === model.modelId
      ? { ...item, ...model } : item))
    const now = new Date().toISOString()
    config.agentProfiles = [{ id: 'ui-review-profile', name: '核对助手', primary: { providerId: provider.providerId, modelId: model.modelId },
      settings: { timeoutMs: 60000, maxRetries: 0, maxOutputTokens: 1024, contextWindowBudget: 32768 }, verifications: [], createdAt: now, updatedAt: now }]
    config.selectedAgentProfileId = 'ui-review-profile'
    await window.henjiNative.llm.writeConfig(config)
    return baseline
  }, { baseUrl, capabilities: spec.capabilities })
  if (spec.memory !== null) {
    await page.evaluate(async (content) => {
      const current = await window.henjiNative.assistant.getSharedMemory()
      await window.henjiNative.assistant.updateSharedMemory({ content, expectedRevision: current.revision })
    }, spec.memory)
  }
  if (spec.newConversation) {
    // 先确认没有进行中的回复（navigate 在运行中会拒绝），再起新对话；会话由主进程持久化，场景之间共享。
    await page.evaluate(async () => {
      const deadline = Date.now() + 15000
      while ((await window.henjiNative.embeddedAgent.snapshot()).busy) {
        if (Date.now() > deadline) throw new Error('进场时助手仍在回复，无法起新对话')
        await window.henjiNative.embeddedAgent.cancel()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      // snapshot.busy 不含主进程的“切换中”（打开历史读取会话列表时），此时 navigate 也会拒绝：按同一条消息退避重试。
      for (;;) {
        try { await window.henjiNative.embeddedAgent.newSession(); return }
        catch (error) {
          if (!String(error?.message ?? error).includes('请先等待当前操作结束') || Date.now() > deadline) throw error
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
    })
  }
  const release = () => {
    const held = fixture.held
    fixture.held = null
    if (!held) throw new Error('没有暂停中的助手回复可以放行')
    held()
  }
  const cleanup = async () => {
    fixture.held?.()
    fixture.held = null
    await page.evaluate(async (baseline) => {
      const deadline = Date.now() + 15000
      while ((await window.henjiNative.embeddedAgent.snapshot()).busy && Date.now() < deadline) {
        await window.henjiNative.embeddedAgent.cancel()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await window.henjiNative.llm.writeConfig(baseline)
    }, baselineConfig).catch(() => undefined)
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  return { release, cleanup }
}

module.exports = { normalizeSeedAssistant, seedAssistantFixture }
