import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { emptyEmbeddedAgentSnapshot, type EmbeddedAgentSnapshot } from '../../../../src/core/assistant/embeddedAgent'
import { visibleMessages } from './messagePresentation'
import type { EngineCommand, EngineConfiguration, EngineEvent, EmbeddedAgentEngine } from './contracts'
import { executePiTool } from './toolResult'
import { PiAttachments } from './piAttachments'
import { PiToolDisclosure } from './toolDisclosure'
import { budgetContext, projectText } from './contextBudget'
import { archiveToolResult, contextReader, selectionSummary } from './contextReader'
import { embeddedModelLimits, embeddedThinkingLevel } from './modelOptions'
import { deduplicateHostContexts, prepareHostContext } from './hostContext'
import { applyProviderRequestBodyQuirks, resolveProviderExtraAuthHeaders, resolveLlmEndpointIdentity } from '@henjicc/ai-sdk'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
export class PiEngine implements EmbeddedAgentEngine {
  private sdk!: PiSdk
  private directory = ''
  private manager!: SessionManager
  private session?: AgentSession
  private configuration?: EngineConfiguration
  private state = emptyEmbeddedAgentSnapshot()
  private unsubscribe?: () => void
  private attachments!: PiAttachments
  private completedIntents = new Set<string>()
  private cancelled = false
  private requestId = ''
  private modelStartedAt = 0
  private usageTotals = this.emptyUsage()
  private emptyUsage() { return { requests: 0, usageResponses: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, toolResults: 0, toolTextBytes: 0, largestToolTextBytes: 0, toolTextByName: {} as Record<string, { calls: number; bytes: number; maxBytes: number }> } }
  private contextMetrics = { contextCount: 0, contextBytes: 0 }
  private disclosure?: PiToolDisclosure
  private toolTitles = new Map<string, string>()
  constructor(private readonly emit: (event: EngineEvent) => void,
    private readonly callTool: (id: string, name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>) {}

  private publish(emit = true): EmbeddedAgentSnapshot {
    if (this.session) {
      this.state.messages = visibleMessages(this.session.messages, this.manager.getSessionId(), this.attachments, this.toolTitles)
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
    const limits = embeddedModelLimits(model)
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
      contextWindow: limits.contextWindow,
      maxTokens: limits.maxOutputTokens,
      cost: { input: model.pricing?.inputPerMillionTokens ?? 0, output: model.pricing?.outputPerMillionTokens ?? 0,
        cacheRead: model.pricing?.cacheReadPerMillionTokens ?? 0, cacheWrite: model.pricing?.cacheWritePerMillionTokens ?? 0 },
    }] })
    await runtime.setRuntimeApiKey(provider, selected.apiKey)
    const resolved = runtime.getModel(provider, model.modelId)
    if (!resolved) throw new Error('所选模型无法初始化，请检查模型设置。')
    // 关掉 Pi 的安装统计，请求不再以 pi.dev 名义给 OpenRouter 等供应商带归因头。
    const settings = this.sdk.SettingsManager.inMemory({ retry: { enabled: false }, enableInstallTelemetry: false })
    const loader = new this.sdk.DefaultResourceLoader({ cwd: this.directory, agentDir: this.directory, settingsManager: settings,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: instructions })
    await loader.reload()
    const customTools: ToolDefinition[] = tools.map((tool) => ({
      name: tool.name, label: tool.title ?? '操作应用', description: tool.description ?? tool.name,
      parameters: tool.inputSchema as ToolDefinition['parameters'], executionMode: 'sequential',
      execute: async (id, args: Record<string, unknown>, signal) => {
        try {
          const result = await executePiTool({ id, name: tool.name, args, signal, vision: model.capabilities.image }, this.callTool)
          if (/^interpret_(video_edit|image_edit)_intent$/.test(tool.name) && args.draftRef && typeof args.draftRef === 'object') this.completedIntents.add(JSON.stringify(args.draftRef))
          return archiveToolResult(this.manager, result, tool.name === 'load_assistant_skill')
        } catch (error) {
          if (!(error instanceof Error) || signal?.aborted) throw error
          const resultId = randomUUID()
          const reference = `tool:${resultId}:0`
          const text = projectText(error.message, reference, 4000)
          if (text === error.message) throw error
          this.manager.appendCustomEntry('henji-tool-result', { resultId, fullText: { '0': error.message } })
          throw new Error(text)
        }
      },
    }))
    this.disclosure = new PiToolDisclosure([...customTools, contextReader(this.manager)], this.manager, () => this.session!)
    this.toolTitles = new Map(this.disclosure.tools.map(tool => [tool.name, tool.label]))
    const { session } = await this.sdk.createAgentSession({ cwd: this.directory, agentDir: this.directory,
      modelRuntime: runtime, model: resolved, thinkingLevel: embeddedThinkingLevel(selected),
      noTools: 'builtin', tools: this.disclosure.tools.map(tool => tool.name), customTools: this.disclosure.tools,
      resourceLoader: loader, sessionManager: this.manager, settingsManager: settings })
    this.session = session
    session.setActiveToolsByName(this.disclosure.initialNames)
    const transformContext = session.agent.transformContext
    session.agent.transformContext = async (messages, signal) => {
      const transformed = await transformContext?.(messages, signal) ?? messages
      const filtered = deduplicateHostContexts(transformed)
      const contexts = filtered.flatMap(message => message.role === 'custom' && message.customType === 'henji-context' ? [message.content] : [])
      this.contextMetrics = { contextCount: contexts.length, contextBytes: Buffer.byteLength(JSON.stringify(contexts), 'utf8') }
      const active = new Set(session.getActiveToolNames())
      return budgetContext(filtered, {
        ...limits,
        instructions: session.systemPrompt, tools: this.disclosure!.tools.filter(tool => active.has(tool.name)),
        attachmentTokens: text => this.attachments.estimateTokens(text),
      })
    }
    const onPayload = session.agent.onPayload
    session.agent.onPayload = async (payload, currentModel) => {
      this.modelStartedAt = Date.now()
      this.usageTotals.requests++
      const base = await onPayload?.(payload, currentModel) ?? payload
      const next = await this.attachments.apply(base, selected)
      const finalPayload = next && typeof next === 'object' && !Array.isArray(next)
        ? applyProviderRequestBodyQuirks(identity.providerFamilyId, next as Record<string, unknown>) : next
      if (finalPayload && typeof finalPayload === 'object' && !Array.isArray(finalPayload)) {
        const body = finalPayload as Record<string, unknown>
        const messages = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : []
        const system = body.system ?? body.instructions ?? messages.filter(message => message && typeof message === 'object'
          && ['system', 'developer'].includes(String((message as Record<string, unknown>).role)))
        const requestTools = Array.isArray(body.tools) ? body.tools : []
        // 只记录尺寸，不复制聊天正文、附件、工具参数或凭据到日志。
        this.emit({ type: 'log', phase: 'model_requested', requestId: this.requestId, sessionId: this.manager.getSessionId(),
          modelId: model.modelId, providerId: selected.providerId,
          requestMetrics: { toolCount: requestTools.length, toolBytes: Buffer.byteLength(JSON.stringify(requestTools), 'utf8'),
            systemBytes: Buffer.byteLength(JSON.stringify(system), 'utf8'), messageCount: messages.length, ...this.contextMetrics } })
      }
      return finalPayload
    }
    let lastTextEmission = 0
    this.unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const { input, output, cacheRead, cacheWrite, totalTokens } = event.message.usage
        if (totalTokens > 0) this.usageTotals.usageResponses++
        this.usageTotals.input += input
        this.usageTotals.output += output
        this.usageTotals.cacheRead += cacheRead
        this.usageTotals.cacheWrite += cacheWrite
        this.emit({ type: 'log', phase: 'model_completed', requestId: this.requestId, sessionId: this.manager.getSessionId(),
          modelId: model.modelId, providerId: selected.providerId, durationMs: Math.max(0, Date.now() - this.modelStartedAt),
          metrics: { input, output, cacheRead, cacheWrite, totalTokens } })
      }
      if (event.type === 'tool_execution_start') this.state.activity = '正在操作应用…'
      if (event.type === 'tool_execution_end') {
        this.state.activity = '正在整理结果…'
        const textBytes = Buffer.byteLength(JSON.stringify(event.result?.content?.filter((part: { type: string }) => part.type === 'text') ?? []), 'utf8')
        const previous = this.usageTotals.toolTextByName[event.toolName] ?? { calls: 0, bytes: 0, maxBytes: 0 }
        this.usageTotals.toolTextByName[event.toolName] = { calls: previous.calls + 1, bytes: previous.bytes + textBytes, maxBytes: Math.max(previous.maxBytes, textBytes) }
        this.usageTotals.toolResults++
        this.usageTotals.toolTextBytes += textBytes
        this.usageTotals.largestToolTextBytes = Math.max(this.usageTotals.largestToolTextBytes, textBytes)
      }
      if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error') {
        this.state.error = event.message.errorMessage ?? '模型请求失败，请检查配置后重试。'
      }
      if (event.type === 'message_update' && event.message.role === 'assistant'
        && ['text_delta', 'thinking_delta'].includes(event.assistantMessageEvent.type)) {
        // Pi 在流式期间尚未把当前消息加入 session.messages。
        if (Date.now() - lastTextEmission < 40) return
        lastTextEmission = Date.now()
        this.publish(false)
        this.emit({ type: 'snapshot', value: { ...this.state, messages: visibleMessages(
          [...this.session!.messages, { ...event.message, stopReason: 'toolUse' }], this.manager.getSessionId(), this.attachments, this.toolTitles) } })
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
        this.state.messages = visibleMessages(manager.buildSessionContext().messages, manager.getSessionId(), this.attachments, this.toolTitles)
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
    this.usageTotals = this.emptyUsage()
    this.completedIntents.clear()
    const startedAt = Date.now()
    this.emit({ type: 'log', phase: 'start', requestId: this.requestId, sessionId: this.manager.getSessionId() })
    this.publish()
    try {
      const guidance = this.disclosure?.prepareContext(command.input.context)
      const selectionSnapshot = command.input.selectionSnapshot
      const selectionId = selectionSnapshot ? randomUUID() : undefined
      const selection = selectionSnapshot && selectionId ? `\n发送时选区（摘要，批量操作前续读全部引用）：${JSON.stringify(selectionSummary(selectionId, selectionSnapshot))}` : ''
      const hostContext = prepareHostContext(command.input.context, this.session.messages, selectionSnapshot,
        `\n当前界面工具入口：${guidance ?? ''}${selection}`)
      if ((command.input.context || selectionSnapshot) && hostContext) await this.session.sendCustomMessage({ customType: 'henji-context',
        content: hostContext.content, display: false,
        details: { ...hostContext.details, ...(selectionSnapshot ? { selectionId, selectionSnapshot } : {}) },
      }, { triggerTurn: false })
      const text = await this.attachments.attach(command.input.text, command.input.attachments ?? [])
      if (!this.cancelled) {
        if (command.input.background) await this.session.sendCustomMessage({ customType: 'henji-memory-organize', content: text, display: false }, { triggerTurn: true })
        else await this.session.prompt(text)
      }
      this.emit({ type: 'log', phase: this.cancelled ? 'cancelled' : this.state.error ? 'failed' : 'completed', requestId: this.requestId,
        durationMs: Date.now() - startedAt, sessionId: this.manager.getSessionId(), message: this.state.error ?? undefined })
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : '回复失败，请重试。'
      this.emit({ type: 'log', phase: this.cancelled ? 'cancelled' : 'failed', requestId: this.requestId,
        durationMs: Date.now() - startedAt, sessionId: this.manager.getSessionId(), message: this.state.error })
    } finally {
      this.attachments.endTurn()
      if (this.state.error && !this.cancelled && command.input.creativeIntent) {
        try {
          for (const draftRef of command.input.creativeIntent.draftRefs) {
            if (this.cancelled) break
            if (this.completedIntents.has(JSON.stringify(draftRef))) continue
            await executePiTool({ id: randomUUID(), name: `organize_${draftRef.kind.split('.')[0]}_intent`, args: { draftRef, operationId: randomUUID() }, vision: false }, this.callTool)
          }
          this.state.error = null
          this.emit({ type: 'log', phase: 'completed', requestId: this.requestId, sessionId: this.manager.getSessionId(), message: '模型未完成，已使用本地整理。' })
        } catch { this.state.error = '模型和本地整理未完成，请保留原稿后重试。' }
      }
      const totalInput = this.usageTotals.input + this.usageTotals.cacheRead + this.usageTotals.cacheWrite
      this.emit({ type: 'log', phase: 'usage_summary', requestId: this.requestId, sessionId: this.manager.getSessionId(),
        providerId: this.configuration?.model.providerId, modelId: this.configuration?.model.model.modelId,
        summary: { ...this.usageTotals, cacheHitRate: totalInput > 0 ? this.usageTotals.cacheRead / totalInput : null } })
      this.state.busy = false; this.state.activity = null; this.publish() }
  }
  async dispose(): Promise<void> { await this.session?.abort(); this.unsubscribe?.(); this.session?.dispose() }
}
