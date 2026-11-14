import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { emptyEmbeddedAgentSnapshot, type EmbeddedAgentSnapshot, type EmbeddedApprovalDecision, type EmbeddedQuestion, type EmbeddedQuestionAnswer } from '../../../../src/core/assistant/embeddedAgent'
import { visibleMessages } from './messagePresentation'
import type { EngineCommand, EngineConfiguration, EngineEvent, EmbeddedAgentEngine } from './contracts'
import { executePiTool } from './toolResult'
import { PiAttachments } from './piAttachments'
import { PiToolDisclosure } from './toolDisclosure'
import { APPLICATION_TOOL_DISPATCHER, disclosureSurface } from './toolDisclosureProfiles'
import { applicationScriptTool } from './applicationScript'
import { createQuestionTools } from './questionTools'
import { addRenamedFileOperations, createLocalTools, LOCAL_MUTATING_TOOLS, localToolStep } from './localTools'
import { budgetContext, contextPageTokenLimit, estimateContextTokens, projectText, PROJECTED_EXCERPT_TOKENS, singleResultTokenLimit } from './contextBudget'
import { archiveToolResult, contextReader, selectionSummary } from './contextReader'
import { embeddedModelCompat, embeddedModelLimits, embeddedModelPricing, embeddedThinkingLevel, embeddedThinkingLevelMap } from './modelOptions'
import { deduplicateHostContexts, leadWithSystemPrompt, prepareHostContext } from './hostContext'
import { appendProviderWebTools, applyProviderRequestBodyQuirks, resolveProviderExtraAuthHeaders, resolveLlmEndpointIdentity } from '@henjicc/ai-sdk'

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
  /** 后台整理记忆在临时会话里进行时为真：界面快照仍是用户那段对话。 */
  private background = false
  /** 分派入口转给内层工具执行的调用：外层调用标识 → 内层调用（交给应用时用的就是内层标识与工具名）。 */
  private dispatched = new Map<string, { toolCallId: string; toolName: string }>()
  /** 正在执行的工具调用；有调用在跑时定时发心跳，宿主的无响应计时不会在长命令中途到点。 */
  private runningTools = new Set<string>()
  private heartbeat?: ReturnType<typeof setInterval>
  private trackTool(id: string, running: boolean): void {
    if (running) this.runningTools.add(id); else this.runningTools.delete(id)
    if (this.runningTools.size && !this.heartbeat) this.heartbeat = setInterval(() => this.emit({ type: 'heartbeat' }), 30_000)
    if (!this.runningTools.size && this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = undefined }
  }
  /** 改前先问：等用户回答的步骤；用户选“这段对话都允许”后，这段对话里的本机改动不再问。 */
  private approvals = new Map<string, (decision: Omit<EmbeddedApprovalDecision, 'id'>) => void>()
  private allowedSession: string | null = null
  resolveApproval({ id, ...decision }: EmbeddedApprovalDecision): void {
    const resolve = this.approvals.get(id)
    this.approvals.delete(id)
    resolve?.(decision)
  }
  private denyPendingApprovals(): void {
    for (const id of [...this.approvals.keys()]) this.resolveApproval({ id, decision: 'deny' })
    for (const id of [...this.questions.keys()]) this.answerQuestion({ id, answers: [], dismissed: true })
  }
  /** ask_user / present_plan 等用户回答的问题。 */
  private questions = new Map<string, (answer: Omit<EmbeddedQuestionAnswer, 'id'>) => void>()
  answerQuestion({ id, ...answer }: EmbeddedQuestionAnswer): void {
    const resolve = this.questions.get(id)
    this.questions.delete(id)
    resolve?.(answer)
  }
  private ask(questions: EmbeddedQuestion[], plan?: string): Promise<Omit<EmbeddedQuestionAnswer, 'id'>> {
    const id = randomUUID()
    return new Promise(resolve => {
      this.questions.set(id, resolve)
      this.emit({ type: 'question', id, questions, ...(plan ? { plan } : {}) })
    })
  }

  /**
   * 按模式拦工具调用。会改东西的：本机命令、写文件、改文件、应用脚本、非只读的应用工具（经分派入口时看内层工具）、
   * 没标只读的助手插件工具。只计划模式一律不执行；改前先问模式只问本机改动与插件工具，应用里的操作能撤销，照常直接做。
   */
  private async gate(name: string, input: unknown, pluginReadOnly: (name: string) => boolean | undefined): Promise<{ block: true; reason: string } | undefined> {
    const mode = this.configuration?.permissionMode ?? 'auto'
    if (mode === 'auto') return undefined
    const host = new Map((this.configuration?.tools ?? []).map(tool => [tool.name, tool]))
    const inner = name === APPLICATION_TOOL_DISPATCHER ? host.get(String((input as { name?: unknown } | undefined)?.name ?? '')) : undefined
    const plugin = !host.has(name) && !this.disclosure?.tools.some(tool => tool.name === name)
    const local = LOCAL_MUTATING_TOOLS.has(name)
    const changesState = local || name === 'run_application_script' || (plugin && pluginReadOnly(name) !== true)
      || (host.has(name) && host.get(name)?.annotations?.readOnlyHint !== true && name !== 'load_assistant_skill')
      || (inner !== undefined && inner.annotations?.readOnlyHint !== true)
    if (!changesState) return undefined
    if (mode === 'plan') return { block: true, reason: '现在是“只计划”模式：这一步会改动东西，没有执行。继续只读地调查，最后把要做的步骤写成编号的计划交给用户，等用户切换模式后再动手。' }
    if (!local && !plugin) return undefined
    const sessionId = this.manager.getSessionId()
    if (this.allowedSession === sessionId) return undefined
    const step = localToolStep(name, input) ?? { title: `运行助手插件 ${name}`, detail: JSON.stringify(input ?? {}).slice(0, 2000) }
    const id = randomUUID()
    const { decision, message } = await new Promise<Omit<EmbeddedApprovalDecision, 'id'>>(resolve => {
      this.approvals.set(id, resolve)
      this.emit({ type: 'approval', id, ...step })
    })
    if (decision === 'allow_session') this.allowedSession = sessionId
    if (decision !== 'deny') return undefined
    return { block: true, reason: message ? `用户没有允许这一步，它没有执行。用户说：${message}` : '用户没有允许这一步，它没有执行。换一种做法，或者先问用户想怎么做。' }
  }

  constructor(private readonly emit: (event: EngineEvent) => void,
    private readonly callTool: (id: string, name: string, input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>) {}

  private publish(emit = true): EmbeddedAgentSnapshot {
    if (this.session && !this.background) {
      this.state.messages = visibleMessages(this.session.messages, this.manager.getSessionId(), this.attachments, this.toolTitles)
    }
    if (!this.background) this.state.sessionId = this.manager?.getSessionId() ?? null
    if (emit) this.emit({ type: 'snapshot', value: { ...this.state } })
    return this.state
  }

  /** 这段对话的工具列表按哪个界面定：第一条消息发出时所在的界面，记在会话里，重开对话后照旧。 */
  private pinnedSurface(context: string): string {
    for (const entry of this.manager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== 'henji-tool-surface') continue
      const surface = (entry.data as { surface?: unknown } | undefined)?.surface
      if (typeof surface === 'string') return surface
    }
    const surface = disclosureSurface(context)
    this.manager.appendCustomEntry('henji-tool-surface', { surface })
    return surface
  }

  private async configure(input: EngineConfiguration): Promise<void> {
    this.unsubscribe?.()
    for (const id of [...this.runningTools]) this.trackTool(id, false)
    await this.closeSession()
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
    const compat = embeddedModelCompat(selected, identity.providerFamilyId)
    runtime.registerProvider(provider, { baseUrl: selected.baseUrl, api: selected.api, headers: resolveProviderExtraAuthHeaders(identity.providerFamilyId, selected.apiKey), models: [{
      id: model.modelId, name: model.displayName, reasoning: model.capabilities.reasoning,
      input: model.capabilities.image ? ['text', 'image'] : ['text'],
      contextWindow: limits.contextWindow,
      maxTokens: limits.maxOutputTokens,
      cost: pricing.cost,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      ...(compat ? { compat } : {}),
    }] })
    await runtime.setRuntimeApiKey(provider, selected.apiKey)
    const resolved = runtime.getModel(provider, model.modelId)
    if (!resolved) throw new Error('所选模型无法初始化，请检查模型设置。')
    // 关掉 Pi 的安装统计，请求不再以 pi.dev 名义给 OpenRouter 等供应商带归因头。
    // Pi 自动压缩要在我们为回复预留的输出空间之前动手，否则长回合会先撞上本地的超窗检查
    const settings = this.sdk.SettingsManager.inMemory({ retry: { enabled: false }, enableInstallTelemetry: false,
      compaction: { enabled: true, reserveTokens: limits.maxOutputTokens + 8192 } }, { projectTrusted: input.projectTrusted })
    /*
     * 助手插件与规则文件（AGENTS.md）照 Pi 的约定从助手目录（全局）和工作文件夹（项目）加载。不信任的项目（别人分享来、用户还没允许）
     * 不加载插件与设置，也不读规则文件：规则文件会以指令身份进系统提示，外来文字只能当数据。
     * 技能只认助手目录与项目里的位置：Pi 默认还会读用户主目录 ~/.agents/skills，那里是用户给别的助手装的技能，
     * 几十份说明会挤进每次请求，还会教这里用不了的工具。
     */
    const skillPaths = [path.join(this.directory, 'skills'), ...input.projectTrusted ? [path.join(input.workFolder, '.pi', 'skills'), path.join(input.workFolder, '.agents', 'skills')] : []]
    const loader = new this.sdk.DefaultResourceLoader({ cwd: input.workFolder, agentDir: this.directory, settingsManager: settings,
      noSkills: true, additionalSkillPaths: skillPaths, noContextFiles: !input.projectTrusted, noPromptTemplates: true, noThemes: true, systemPrompt: instructions,
      extensionFactories: [pi => {
        pi.on('session_before_compact', event => { addRenamedFileOperations(event.preparation) })
        pi.on('tool_call', event => this.gate(event.toolName, event.input, name => pi.getAllTools().find(tool => tool.name === name)?.annotations?.readOnlyHint))
      }] })
    await loader.reload()
    for (const error of loader.getExtensions().errors) this.emit({ type: 'log', phase: 'extension_failed', requestId: this.requestId, sessionId: this.manager.getSessionId(), message: `助手插件 ${error.path} 加载失败：${error.error}` })
    /** 成功与失败的文字都受单条结果上限约束，超出部分存档后可续读。 */
    const bounded = async (run: () => Promise<Awaited<ReturnType<ToolDefinition['execute']>>>, signal?: AbortSignal) => {
      try { return archiveToolResult(this.manager, await run(), resultLimit) } catch (error) {
        if (!(error instanceof Error) || signal?.aborted) throw error
        const resultId = randomUUID()
        const reference = `tool:${resultId}:0`
        const text = estimateContextTokens(error.message) <= resultLimit ? error.message : projectText(error.message, reference, PROJECTED_EXCERPT_TOKENS)
        if (text === error.message) throw error
        this.manager.appendCustomEntry('henji-tool-result', { resultId, fullText: { '0': error.message } })
        throw new Error(text)
      }
    }
    const customTools: ToolDefinition[] = tools.map((tool) => ({
      name: tool.name, label: tool.title ?? '操作应用', description: tool.description ?? tool.name,
      parameters: tool.inputSchema as ToolDefinition['parameters'], executionMode: 'sequential',
      execute: (id, args: Record<string, unknown>, signal) => bounded(async () => {
        const result = await executePiTool({ id, name: tool.name, args, signal, vision: model.capabilities.image }, this.callTool)
        if (tool.name === 'interpret_intent' && args.draftRef && typeof args.draftRef === 'object') this.completedIntents.add(JSON.stringify(args.draftRef))
        return result
      }, signal),
    }))
    // 脚本里的调用与模型直接调用共用 callTool 这一个出口。
    const script = applicationScriptTool({ tools, call: this.callTool })
    const scriptTool: ToolDefinition = { ...script, execute: (...args) => bounded(() => script.execute(...args), args[2]) }
    this.disclosure = new PiToolDisclosure([...customTools, contextReader(this.manager, contextPageTokenLimit(limits.contextWindow)), scriptTool,
      ...createLocalTools(this.sdk, input.workFolder),
      ...createQuestionTools(input.permissionMode, (questions, plan) => this.ask(questions, plan), mode => { if (this.configuration) this.configuration.permissionMode = mode })], () => this.session!)
    this.toolTitles = new Map(this.disclosure.tools.map(tool => [tool.name, tool.label]))
    // 不给工具白名单：助手插件注册的工具与宿主工具一起可用。
    const { session } = await this.sdk.createAgentSession({ cwd: input.workFolder, agentDir: this.directory,
      modelRuntime: runtime, model: resolved, thinkingLevel: embeddedThinkingLevel(selected),
      noTools: 'builtin', customTools: this.disclosure.tools,
      resourceLoader: loader, sessionManager: this.manager, settingsManager: settings })
    this.session = session
    await session.bindExtensions({ onError: error => this.emit({ type: 'log', phase: 'extension_failed', requestId: this.requestId, sessionId: this.manager.getSessionId(),
      message: `助手插件 ${error.extensionPath} 在 ${error.event} 出错：${error.error}` }) })
    const hostTools = new Set(this.disclosure.tools.map(tool => tool.name))
    session.setActiveToolsByName([...this.disclosure.initialNames, ...session.getActiveToolNames().filter(name => !hostTools.has(name))])
    const transformContext = session.agent.transformContext
    session.agent.transformContext = async (messages, signal) => {
      const transformed = await transformContext?.(messages, signal) ?? messages
      const filtered = this.disclosure!.redirectUndeclaredCalls(leadWithSystemPrompt(deduplicateHostContexts(transformed)))
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
      // 助手在供应商支持时自动联网：搜索与读链接由模型自行决定、服务端执行。
      const webToolProtocol = selected.api === 'openai-responses' ? 'openai-responses' : selected.api === 'openai-completions' ? 'openai-compatible' : null
      const finalPayload = next && typeof next === 'object' && !Array.isArray(next)
        ? applyProviderRequestBodyQuirks(identity.providerFamilyId, webToolProtocol
          ? appendProviderWebTools(identity.providerFamilyId, model.adapter, next as Record<string, unknown>, webToolProtocol)
          : next as Record<string, unknown>) : next
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
      if (event.type === 'tool_execution_start') { this.state.activity = '正在操作应用…'; this.toolArgs.set(event.toolCallId, event.args); this.trackTool(event.toolCallId, true) }
      if (event.type === 'tool_execution_end') {
        this.trackTool(event.toolCallId, false)
        // 经分派入口的调用只记一步，记在内层工具名与内层调用标识下，回执取模型实际看到的外层结果
        if (event.parentToolCallId) { this.dispatched.set(event.parentToolCallId, { toolCallId: event.toolCallId, toolName: event.toolName }); return }
        const { toolCallId, toolName } = this.dispatched.get(event.toolCallId) ?? event
        this.dispatched.delete(event.toolCallId)
        this.state.activity = '正在整理结果…'
        const textBytes = Buffer.byteLength(JSON.stringify(event.result?.content?.filter((part: { type: string }) => part.type === 'text') ?? []), 'utf8')
        const previous = this.usageTotals.toolTextByName[toolName] ?? { calls: 0, bytes: 0, maxBytes: 0 }
        this.usageTotals.toolTextByName[toolName] = { calls: previous.calls + 1, bytes: previous.bytes + textBytes, maxBytes: Math.max(previous.maxBytes, textBytes) }
        this.usageTotals.toolResults++
        this.usageTotals.toolTextBytes += textBytes
        this.usageTotals.largestToolTextBytes = Math.max(this.usageTotals.largestToolTextBytes, textBytes)
        const resultText = (event.result?.content ?? []).flatMap((part: { type: string; text?: string }) => part.type === 'text' && part.text ? [part.text] : []).join('\n').slice(0, 4000)
        this.emit({ type: 'log', phase: 'tool_executed', requestId: this.requestId, sessionId: this.manager.getSessionId(),
          tool: { toolCallId, toolName, args: this.toolArgs.get(toolCallId), isError: event.isError, durationMs: event.durationMs, resultText } })
        this.toolArgs.delete(toolCallId); this.toolArgs.delete(event.toolCallId)
      }
      if (event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error') {
        this.state.error = event.message.errorMessage ?? '模型请求失败，请检查配置后重试。'
      }
      if (event.type === 'message_update' && event.message.role === 'assistant'
        && ['text_delta', 'thinking_delta'].includes(event.assistantMessageEvent.type)) {
        // Pi 在流式期间尚未把当前消息加入 session.messages。
        if (this.background || Date.now() - lastTextEmission < 40) return
        lastTextEmission = Date.now()
        this.publish(false)
        this.emit({ type: 'snapshot', value: { ...this.state, messages: visibleMessages(
          [...this.session!.messages, { ...event.message, stopReason: 'toolUse' }], this.manager.getSessionId(), this.attachments, this.toolTitles) } })
      } else if (event.type === 'message_start' || event.type === 'message_end' || event.type === 'tool_execution_start' || event.type === 'tool_execution_end') this.publish()
    })
    this.publish()
  }

  async command(command: EngineCommand): Promise<unknown> {
    // 先回绝等确认的步骤：中止会等正在执行的工具结束，而那个工具正在等用户
    if (command.action === 'cancel') { this.cancelled = true; this.denyPendingApprovals(); await this.session?.abort(); return }
    if (command.action === 'snapshot') return this.publish()
    // 插入的话不停下当前这轮：Pi 在当前一步做完后把它放进对话，模型下一步就能看到
    if (command.action === 'steer') {
      if (!this.session?.isStreaming || this.cancelled || this.background) throw new Error('助手这一轮已经结束，请直接发送。')
      await this.session.steer(command.input)
      return this.publish()
    }
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
    /*
     * 后台整理记忆另开一段不落盘的临时会话：混进用户对话时，这次请求要带着用户的整段历史、却换了系统设定与模型，
     * 整段按未命中计费；整理过程的往返还会留在用户对话里，占住之后每一次请求的上下文。
     */
    const user = command.input.background ? { manager: this.manager, attachments: this.attachments } : undefined
    try {
      if (user) {
        this.background = true
        this.manager = this.sdk.SessionManager.inMemory(this.directory)
        this.attachments = new PiAttachments(this.directory, this.manager)
        await this.configure(this.configuration!)
      }
      this.emit({ type: 'log', phase: 'start', requestId: this.requestId, sessionId: this.manager.getSessionId() })
      this.publish()
      const guidance = this.disclosure?.prepareContext(command.input.context, this.pinnedSurface(command.input.context))
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
            await executePiTool({ id: randomUUID(), name: 'organize_intent', args: { draftRef, operationId: randomUUID() }, vision: false }, this.callTool)
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
      if (user) {
        // 回到用户的对话；整理失败不算用户这次回复的错误
        this.manager = user.manager; this.attachments = user.attachments
        this.state.error = null
        this.background = false
        // 先解除忙碌再重建会话：重建失败时下一条消息照常重新配置，不能把助手卡在忙碌状态
        this.state.busy = false; this.state.activity = null
        await this.configure(this.configuration!).catch(() => { this.session = undefined })
      }
      this.state.busy = false; this.state.activity = null; this.publish() }
  }
  /** 每条消息都会重建会话：先让助手插件收尾（停掉它起的子进程、服务与文件监视），否则每条消息累积一份。 */
  private async closeSession(): Promise<void> {
    const runner = this.session?.extensionRunner
    if (runner?.hasHandlers('session_shutdown')) await runner.emit({ type: 'session_shutdown', reason: 'reload' }).catch(() => undefined)
    this.session?.dispose()
  }
  async dispose(): Promise<void> { this.denyPendingApprovals(); await this.session?.abort(); this.unsubscribe?.(); await this.closeSession(); for (const id of [...this.runningTools]) this.trackTool(id, false) }
}
