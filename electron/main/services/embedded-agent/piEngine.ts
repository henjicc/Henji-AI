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
import { budgetContext, contextPageTokenLimit, estimateContextTokens, projectText, PROJECTED_EXCERPT_TOKENS, singleResultTokenLimit } from './contextBudget'
import { archiveToolResult, contextReader, selectionSummary } from './contextReader'
import { embeddedModelLimits, embeddedModelPricing, embeddedThinkingLevel, embeddedThinkingLevelMap } from './modelOptions'
import { deduplicateHostContexts, prepareHostContext } from './hostContext'
import { applyProviderRequestBodyQuirks, resolveProviderExtraAuthHeaders, resolveLlmEndpointIdentity } from '@henjicc/ai-sdk'

type PiSdk = typeof import('@earendil-works/pi-coding-agent')
/**
 * 本回合最后一条带文字的模型消息（不含思考与工具调用），写进回合结束日志，链路排查不依赖界面快照。
 * 从末尾往前找到本回合的发起消息为止（用户消息，或记忆整理的自定义消息）：回合中途压缩会改写更早的历史，按下标切会错位。
 */
function turnAnswer(messages: AgentSession['messages']): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user' || message.role === 'custom') break
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    const text = message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('').trim()
    if (text) return text
  }
  return ''
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
  private completedIntents = new Set<string>()
  private cancelled = false
  private requestId = ''
  private modelStartedAt = 0
  private usageTotals = this.emptyUsage()
  private firstTokenAt = 0
  private costCurrency: 'CNY' | 'USD' | null = null
  private emptyUsage() { return { requests: 0, usageResponses: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0,
    firstTokenMsTotal: 0, firstTokenSamples: 0, firstTokenMsMax: 0,
    toolResults: 0, toolTextBytes: 0, largestToolTextBytes: 0, toolTextByName: {} as Record<string, { calls: number; bytes: number; maxBytes: number }> } }
  private contextMetrics = { contextCount: 0, contextBytes: 0 }
  private disclosure?: PiToolDisclosure
  private toolTitles = new Map<string, string>()
  private toolArgs = new Map<string, unknown>()
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
    const resultLimit = singleResultTokenLimit(limits.contextWindow)
    const runtime = await this.sdk.ModelRuntime.create({
      authPath: path.join(this.directory, 'auth.json'), modelsPath: null,
      modelsStorePath: path.join(this.directory, 'model-cache.json'), allowModelNetwork: false, refreshOnCreate: false,
    })
    // 配置值解释器支持执行命令；密钥只经过运行时凭据接口，不能作为配置表达式传入。
    const provider = 'henji-selected'
    const identity = resolveLlmEndpointIdentity({ ...model, baseUrl: selected.baseUrl })
    const pricing = embeddedModelPricing(selected)
    this.costCurrency = pricing.currency
    const thinkingLevelMap = embeddedThinkingLevelMap(selected, identity.providerFamilyId)
    runtime.registerProvider(provider, { baseUrl: selected.baseUrl, api: selected.api, headers: resolveProviderExtraAuthHeaders(identity.providerFamilyId, selected.apiKey), models: [{
      id: model.modelId, name: model.displayName, reasoning: model.capabilities.reasoning,
      input: model.capabilities.image ? ['text', 'image'] : ['text'],
      contextWindow: limits.contextWindow,
      maxTokens: limits.maxOutputTokens,
      cost: pricing.cost,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    }] })
    await runtime.setRuntimeApiKey(provider, selected.apiKey)
    const resolved = runtime.getModel(provider, model.modelId)
    if (!resolved) throw new Error('所选模型无法初始化，请检查模型设置。')
    // 关掉 Pi 的安装统计，请求不再以 pi.dev 名义给 OpenRouter 等供应商带归因头。
    // Pi 自动压缩要在我们为回复预留的输出空间之前动手，否则长回合会先撞上本地的超窗检查
    const settings = this.sdk.SettingsManager.inMemory({ retry: { enabled: false }, enableInstallTelemetry: false,
      compaction: { enabled: true, reserveTokens: limits.maxOutputTokens + 8192 } })
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
          return archiveToolResult(this.manager, result, resultLimit)
        } catch (error) {
          if (!(error instanceof Error) || signal?.aborted) throw error
          const resultId = randomUUID()
          const reference = `tool:${resultId}:0`
          const text = estimateContextTokens(error.message) <= resultLimit ? error.message : projectText(error.message, reference, PROJECTED_EXCERPT_TOKENS)
          if (text === error.message) throw error
          this.manager.appendCustomEntry('henji-tool-result', { resultId, fullText: { '0': error.message } })
          throw new Error(text)
        }
      },
    }))
    this.disclosure = new PiToolDisclosure([...customTools, contextReader(this.manager, contextPageTokenLimit(limits.contextWindow))], this.manager, () => this.session!)
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
      this.firstTokenAt = 0
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
        // 请求体含整段历史与附件，只记录尺寸；本轮输入、工具参数与回复在各自的链路日志里。
        this.emit({ type: 'log', phase: 'model_requested', requestId: this.requestId, sessionId: this.manager.getSessionId(),
          modelId: model.modelId, providerId: selected.providerId, turn: this.usageTotals.requests,
          requestMetrics: { toolCount: requestTools.length, toolBytes: Buffer.byteLength(JSON.stringify(requestTools), 'utf8'),
            systemBytes: Buffer.byteLength(JSON.stringify(system), 'utf8'), messageCount: messages.length, ...this.contextMetrics } })
      }
      return finalPayload
    }
    let lastTextEmission = 0
    this.unsubscribe = session.subscribe((event) => {
      if (event.type === 'message_update' && event.message.role === 'assistant' && !this.firstTokenAt) this.firstTokenAt = Date.now()
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        const { input, output, cacheRead, cacheWrite, totalTokens, reasoning, cost } = event.message.usage
        // 首个流式增量（思考、正文或工具参数）距请求发出的时间；没有增量（请求直接失败）时不记
        const firstTokenMs = this.firstTokenAt ? Math.max(0, this.firstTokenAt - this.modelStartedAt) : undefined
        const totals = this.usageTotals
        if (totalTokens > 0) totals.usageResponses++
        totals.input += input
        totals.output += output
        totals.cacheRead += cacheRead
        totals.cacheWrite += cacheWrite
        totals.reasoning += reasoning ?? 0
        totals.cost += cost?.total ?? 0
        if (firstTokenMs !== undefined) {
          totals.firstTokenMsTotal += firstTokenMs; totals.firstTokenSamples++
          totals.firstTokenMsMax = Math.max(totals.firstTokenMsMax, firstTokenMs)
        }
        const promptTokens = input + cacheRead + cacheWrite
        this.emit({ type: 'log', phase: 'model_completed', requestId: this.requestId, sessionId: this.manager.getSessionId(),
          modelId: model.modelId, providerId: selected.providerId, durationMs: Math.max(0, Date.now() - this.modelStartedAt),
          turn: totals.requests, stopReason: event.message.stopReason,
          ...(event.message.stopReason === 'error' ? { message: event.message.errorMessage ?? '模型请求失败' } : {}),
          metrics: { input, output, cacheRead, cacheWrite, totalTokens, cacheHitRate: promptTokens > 0 ? cacheRead / promptTokens : null,
            ...(reasoning !== undefined ? { reasoning } : {}), ...(firstTokenMs !== undefined ? { firstTokenMs } : {}),
            ...(this.costCurrency && cost ? { cost: cost.total, costCurrency: this.costCurrency } : {}) } })
      }
      if (event.type === 'tool_execution_start') { this.state.activity = '正在操作应用…'; this.toolArgs.set(event.toolCallId, event.args) }
      if (event.type === 'tool_execution_end') {
        this.state.activity = '正在整理结果…'
        const textBytes = Buffer.byteLength(JSON.stringify(event.result?.content?.filter((part: { type: string }) => part.type === 'text') ?? []), 'utf8')
        const previous = this.usageTotals.toolTextByName[event.toolName] ?? { calls: 0, bytes: 0, maxBytes: 0 }
        this.usageTotals.toolTextByName[event.toolName] = { calls: previous.calls + 1, bytes: previous.bytes + textBytes, maxBytes: Math.max(previous.maxBytes, textBytes) }
        this.usageTotals.toolResults++
        this.usageTotals.toolTextBytes += textBytes
        this.usageTotals.largestToolTextBytes = Math.max(this.usageTotals.largestToolTextBytes, textBytes)
        const resultText = (event.result?.content ?? []).flatMap((part: { type: string; text?: string }) => part.type === 'text' && part.text ? [part.text] : []).join('\n').slice(0, 4000)
        this.emit({ type: 'log', phase: 'tool_executed', requestId: this.requestId, sessionId: this.manager.getSessionId(),
          tool: { toolCallId: event.toolCallId, toolName: event.toolName, args: this.toolArgs.get(event.toolCallId), isError: event.isError, durationMs: event.durationMs, resultText } })
        this.toolArgs.delete(event.toolCallId)
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
        durationMs: Date.now() - startedAt, sessionId: this.manager.getSessionId(), message: this.state.error ?? undefined, answer: turnAnswer(this.session.messages) })
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
      const { firstTokenMsTotal, firstTokenSamples, firstTokenMsMax, cost, ...totals } = this.usageTotals
      const totalInput = totals.input + totals.cacheRead + totals.cacheWrite
      this.emit({ type: 'log', phase: 'usage_summary', requestId: this.requestId, sessionId: this.manager.getSessionId(),
        providerId: this.configuration?.model.providerId, modelId: this.configuration?.model.model.modelId,
        summary: { ...totals, cacheHitRate: totalInput > 0 ? totals.cacheRead / totalInput : null,
          ...(firstTokenSamples ? { firstTokenMsAverage: Math.round(firstTokenMsTotal / firstTokenSamples), firstTokenMsMax } : {}),
          ...(this.costCurrency ? { cost, costCurrency: this.costCurrency } : {}) } })
      this.state.busy = false; this.state.activity = null; this.publish() }
  }
  async dispose(): Promise<void> { await this.session?.abort(); this.unsubscribe?.(); this.session?.dispose() }
}
