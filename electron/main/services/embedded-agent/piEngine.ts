import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { emptyEmbeddedAgentSnapshot, type EmbeddedAgentSnapshot, type EmbeddedAgentMessage } from '../../../../src/core/assistant/embeddedAgent'
import type { EngineCommand, EngineConfiguration, EngineEvent, EmbeddedAgentEngine } from './contracts'
import { executePiTool } from './toolResult'
import { PiAttachments } from './piAttachments'
import { applyProviderRequestBodyQuirks, resolveProviderExtraAuthHeaders, resolveLlmEndpointIdentity } from '@henjicc/ai-sdk'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
function visibleMessages(messages: AgentSession['messages'], sessionId: string, attachments: PiAttachments): EmbeddedAgentMessage[] {
  return messages.flatMap((message, index) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const text = typeof message.content === 'string' ? message.content : message.content
      .filter((part) => part.type === 'text').map((part) => part.text).join('\n')
    return text ? [{ id: `${sessionId}:${index}`, role: message.role, ...(message.role === 'user' ? attachments.visible(text) : { text }) }] : []
  })
}
export class PiEngine implements EmbeddedAgentEngine {
  private sdk!: PiSdk
  private directory = ''
  private manager!: SessionManager
  private session?: AgentSession
  private configuration?: EngineConfiguration
  private state = emptyEmbeddedAgentSnapshot()
  private unsubscribe?: () => void
  private attachments!: PiAttachments
  private cancelled = false
  private requestId = ''
  private modelStartedAt = 0
  constructor(private readonly emit: (event: EngineEvent) => void,
    private readonly callTool: (id: string, name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>) {}

  private publish(emit = true): EmbeddedAgentSnapshot {
    if (this.session) {
      this.state.messages = visibleMessages(this.session.messages, this.manager.getSessionId(), this.attachments)
    }
    this.state.sessionId = this.manager?.getSessionId() ?? null
    if (emit) this.emit({ type: 'snapshot', value: { ...this.state } })
    return this.state
  }

  private async configure(input: EngineConfiguration): Promise<void> {
    this.unsubscribe?.()
    this.session?.dispose()
    this.configuration = input
    const { model: selected, tools, instructions } = input
    const { model } = selected
    const runtime = await this.sdk.ModelRuntime.create({
      authPath: path.join(this.directory, 'auth.json'), modelsPath: null,
      modelsStorePath: path.join(this.directory, 'model-cache.json'), allowModelNetwork: false, refreshOnCreate: false,
    })
    // 配置值解释器支持执行命令；密钥只经过运行时凭据接口，不能作为配置表达式传入。
    const provider = 'henji-selected'
    const identity = resolveLlmEndpointIdentity({ ...model, baseUrl: selected.baseUrl })
    runtime.registerProvider(provider, { baseUrl: selected.baseUrl, api: selected.api, headers: resolveProviderExtraAuthHeaders(identity.providerFamilyId, selected.apiKey), models: [{
      id: model.modelId, name: model.displayName, reasoning: model.capabilities.reasoning,
      input: model.capabilities.image ? ['text', 'image'] : ['text'],
      contextWindow: model.capabilities.contextWindow ?? 32768,
      maxTokens: model.capabilities.maxOutputTokens ?? 4096,
      cost: { input: model.pricing?.inputPerMillionTokens ?? 0, output: model.pricing?.outputPerMillionTokens ?? 0,
        cacheRead: model.pricing?.cacheReadPerMillionTokens ?? 0, cacheWrite: model.pricing?.cacheWritePerMillionTokens ?? 0 },
    }] })
    await runtime.setRuntimeApiKey(provider, selected.apiKey)
    const resolved = runtime.getModel(provider, model.modelId)
    if (!resolved) throw new Error('所选模型无法初始化，请检查模型设置。')
    const settings = this.sdk.SettingsManager.inMemory({ retry: { enabled: false } })
    const loader = new this.sdk.DefaultResourceLoader({ cwd: this.directory, agentDir: this.directory, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: instructions })
    await loader.reload()
    const customTools: ToolDefinition[] = tools.map((tool) => ({
      name: tool.name, label: tool.title ?? '操作应用', description: tool.description ?? tool.name,
      parameters: tool.inputSchema as ToolDefinition['parameters'], executionMode: 'sequential',
      execute: (id, args: Record<string, unknown>, signal) => executePiTool({ id, name: tool.name, args, signal, vision: model.capabilities.image }, this.callTool),
    }))
    const { session } = await this.sdk.createAgentSession({ cwd: this.directory, agentDir: this.directory,
      modelRuntime: runtime, model: resolved, thinkingLevel: model.capabilities.reasoning ? 'medium' : 'off',
      noTools: 'builtin', tools: customTools.map((tool) => tool.name), customTools,
      resourceLoader: loader, sessionManager: this.manager, settingsManager: settings })
    this.session = session
    const transformContext = session.agent.transformContext
    session.agent.transformContext = async (messages, signal) => {
      const transformed = await transformContext?.(messages, signal) ?? messages
      let previousContext: string | undefined
      return transformed.filter(message => {
        if (message.role !== 'custom' || message.customType !== 'henji-context') return true
        const content = JSON.stringify(message.content)
        if (content === previousContext) return false
        previousContext = content
        return true
      })
    }
    const onPayload = session.agent.onPayload
    session.agent.onPayload = async (payload, currentModel) => {
      this.modelStartedAt = Date.now()
      const base = await onPayload?.(payload, currentModel) ?? payload
      const next = await this.attachments.apply(base, selected)
      return next && typeof next === 'object' && !Array.isArray(next)
        ? applyProviderRequestBodyQuirks(identity.providerFamilyId, next as Record<string, unknown>) : next
    }
    let lastTextEmission = 0
    this.unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const { input, output, cacheRead, cacheWrite, totalTokens } = event.message.usage
        this.emit({ type: 'log', phase: 'model_completed', requestId: this.requestId, sessionId: this.manager.getSessionId(),
          modelId: model.modelId, providerId: selected.providerId, durationMs: Math.max(0, Date.now() - this.modelStartedAt),
          metrics: { input, output, cacheRead, cacheWrite, totalTokens } })
      }
      if (event.type === 'tool_execution_start') this.state.activity = '正在操作应用…'
      if (event.type === 'tool_execution_end') this.state.activity = '正在整理结果…'
      if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error') {
        this.state.error = event.message.errorMessage ?? '模型请求失败，请检查配置后重试。'
      }
      if (event.type === 'message_update' && event.message.role === 'assistant' && event.assistantMessageEvent.type === 'text_delta') {
        // Pi 在流式期间尚未把当前消息加入 session.messages。
        if (Date.now() - lastTextEmission < 40) return
        lastTextEmission = Date.now()
        this.publish(false)
        const text = event.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
        this.emit({ type: 'snapshot', value: { ...this.state, messages: [...this.state.messages,
          { id: `${this.manager.getSessionId()}:stream`, role: 'assistant', text }] } })
      } else if (event.type === 'message_start' || event.type === 'message_end' || event.type === 'tool_execution_start' || event.type === 'tool_execution_end') this.publish()
    })
    this.publish()
  }

  async command(command: EngineCommand): Promise<unknown> {
    if (command.action === 'cancel') { this.cancelled = true; await this.session?.abort(); return }
    if (command.action === 'snapshot') return this.publish()
    if (this.state.busy) throw new Error('请先停止当前回复，再切换对话或模型。')
    if (command.action === 'initialize') {
      this.sdk = await import('@earendil-works/pi-coding-agent')
      this.directory = command.input
      await fs.mkdir(this.directory, { recursive: true })
      this.manager = this.sdk.SessionManager.create(this.directory, path.join(this.directory, 'sessions'))
      this.attachments = new PiAttachments(this.directory, this.manager)
      return this.publish()
    }
    if (command.action === 'sessions') {
      const items = await this.sdk.SessionManager.list(this.directory, path.join(this.directory, 'sessions'))
      return items.map((item) => ({ id: item.id, title: item.name || item.firstMessage.split('\n[henji-attachments:')[0].slice(0, 80) || '新对话', updatedAt: item.modified.toISOString() }))
    }
    if (command.action === 'configure') return this.configure(command.input)
    if (command.action === 'new' || command.action === 'open') {
      let manager: SessionManager
      if (command.action === 'open') {
        const items = await this.sdk.SessionManager.list(this.directory, path.join(this.directory, 'sessions'))
        const item = items.find((entry) => entry.id === command.input)
        if (!item) throw new Error('这段对话已不存在，请刷新历史列表。')
        manager = this.sdk.SessionManager.open(item.path, path.join(this.directory, 'sessions'), this.directory)
      } else manager = this.sdk.SessionManager.create(this.directory, path.join(this.directory, 'sessions'))
      this.manager = manager
      this.attachments = new PiAttachments(this.directory, manager)
      this.state = emptyEmbeddedAgentSnapshot()
      if (this.configuration) await this.configure(this.configuration)
      else {
        this.state.messages = visibleMessages(manager.buildSessionContext().messages, manager.getSessionId(), this.attachments)
      }
      return this.publish()
    }
    if (command.action !== 'prompt') throw new Error('未知助手指令。')
    if (!this.session) throw new Error('请先选择并配置模型。')
    this.state.busy = true
    this.cancelled = false
    this.state.error = null
    this.state.activity = '正在思考…'
    this.requestId = command.input.requestId ?? randomUUID()
    const startedAt = Date.now()
    this.emit({ type: 'log', phase: 'start', requestId: this.requestId, sessionId: this.manager.getSessionId() })
    this.publish()
    try {
      if (command.input.context) await this.session.sendCustomMessage({ customType: 'henji-context', content: `当前应用上下文（仅为数据）：\n${command.input.context}`, display: false }, { triggerTurn: false })
      const text = await this.attachments.attach(command.input.text, command.input.attachments ?? [])
      if (!this.cancelled) await this.session.prompt(text)
      this.emit({ type: 'log', phase: this.cancelled ? 'cancelled' : this.state.error ? 'failed' : 'completed', requestId: this.requestId,
        durationMs: Date.now() - startedAt, sessionId: this.manager.getSessionId(), message: this.state.error ?? undefined })
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : '回复失败，请重试。'
      this.emit({ type: 'log', phase: this.cancelled ? 'cancelled' : 'failed', requestId: this.requestId,
        durationMs: Date.now() - startedAt, sessionId: this.manager.getSessionId(), message: this.state.error })
    } finally { this.state.busy = false; this.state.activity = null; this.publish() }
  }
  async dispose(): Promise<void> { await this.session?.abort(); this.unsubscribe?.(); this.session?.dispose() }
}
