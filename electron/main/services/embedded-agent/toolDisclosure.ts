import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { isPaidCapability } from '../application-runtime/toolCatalog'

import { APPLICATION_TOOL_DISPATCHER, basicTools, disclosureSurface, domainProfiles, sharedDomainTools, surfaceProfile, taskProfiles } from './toolDisclosureProfiles'

type LoadRequest = { domains?: string[]; names?: string[]; task?: keyof typeof taskProfiles }
type ToolResult = Awaited<ReturnType<ToolDefinition['execute']>>
type AgentMessage = AgentSession['messages'][number]
const domainOf = (name: string) => BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.domain
const definitionOf = (tool: ToolDefinition) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })

/** 目录里每个工具只给一句用途：说明的第一句，不截断半句。 */
function purposeOf(tool: ToolDefinition): string {
  const first = /^(.+?[。；！？])/.exec(tool.description)?.[1] ?? tool.description
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.name)
  return definition && isPaidCapability(definition) ? `${first}（付费）` : first
}

/** 模型常把 input 写成 JSON 字符串，或把内层参数平铺在顶层；按本意归位后再校验。 */
function normalizeDispatchArguments(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const { name, input, ...rest } = raw as Record<string, unknown>
  if (typeof input === 'string') { try { return { name, input: JSON.parse(input) as unknown } } catch { return raw } }
  return input === undefined && Object.keys(rest).length ? { name, input: rest } : raw
}

/**
 * 注册目录保持完整授权集合；发给模型的原生工具列表在同一界面内固定：基础工具、界面基线、加载与分派两个入口。
 *
 * - 专用工具的定义由 load_application_tools 作为工具结果写进对话末尾，再由 call_application_tool 按名调用。
 *   供应商把工具列表排在对话历史之前，列表一变其后的历史全部按未命中重算（DeepSeek 未命中单价是命中的 50 倍），
 *   所以加载不能动工具列表。Pi 能把新增工具放在历史之后的只有 Kimi、OpenAI Responses 与 Anthropic 的专用写法。
 * - 分派走 Pi 的 ctx.executeTool：参数的类型纠正、校验与执行同模型直接调用一致。
 * - 只按工具名或任务加载，按领域只返回目录：整领域的定义约十万 token，真实会话里用到的只有两三个。
 */
export class PiToolDisclosure {
  readonly tools: ToolDefinition[]
  readonly initialNames: string[]
  private readonly deferred: string[]
  private scope = 'workspace.unknown'

  constructor(tools: ToolDefinition[], private readonly session: () => AgentSession) {
    this.deferred = tools.filter(tool => !basicTools.has(tool.name) && (domainOf(tool.name)
      || ['describe_application_contract', 'read_application_media', 'get_application_operation', 'retry_application_operation_save', 'review_application_operation'].includes(tool.name))).map(tool => tool.name)
    const domains = [...new Set(this.deferred.map(domainOf).filter((domain): domain is string => Boolean(domain)))].sort()
    // 说明里列出各领域的工具名，模型才能一步按名加载，不必先查目录。
    const ungrouped = this.deferred.filter(name => !domainOf(name)).sort()
    const namesByDomain = [...domains.map(domain => `${domain}：${this.deferred.filter(name => domainOf(name) === domain).sort().join(',')}`),
      ...(ungrouped.length ? [`其他：${ungrouped.join(',')}`] : [])].join('；')
    const loader: ToolDefinition = { name: 'load_application_tools', label: '加载应用工具',
      description: `返回专用工具的说明与参数，这些工具不进工具列表，随后用 ${APPLICATION_TOOL_DISPATCHER} 调用。names：一次列齐本步要用的工具名；task：按任务一次取一组，canvas_generation（画布生成）、canvas_nodes（节点详情）、generation（生成页）；domains：只返回该领域每个工具的一句用途和做法，不确定用哪个工具时先查。前文已返回过的不必重复加载。各领域工具名：${namesByDomain}。`,
      parameters: { type: 'object', properties: {
        task: { type: 'string', enum: Object.keys(taskProfiles) },
        domains: { type: 'array', items: { type: 'string', enum: domains }, maxItems: 16 },
        names: { type: 'array', items: { type: 'string' }, maxItems: 32 },
      }, additionalProperties: false } as ToolDefinition['parameters'],
      exposure: 'model-only', executionMode: 'sequential',
      execute: async (_id, args) => this.load(args as LoadRequest),
    }
    const dispatcher: ToolDefinition = { name: APPLICATION_TOOL_DISPATCHER, label: '调用应用工具',
      description: `调用不在工具列表里的应用工具。name：工具名；input：该工具的参数，按 load_application_tools 返回的 parameters 填写。已在工具列表里的工具直接调用，不经过这里。`,
      parameters: { type: 'object', properties: { name: { type: 'string' }, input: { type: 'object' } },
        required: ['name'], additionalProperties: false } as ToolDefinition['parameters'],
      prepareArguments: normalizeDispatchArguments as ToolDefinition['prepareArguments'],
      exposure: 'model-only', executionMode: 'sequential',
      execute: async (_id, args, signal, _onUpdate, ctx) => {
        const { name, input } = args as { name: string; input?: Record<string, unknown> }
        const tool = this.tools.find(item => item.name === name)
        if (!tool) throw new Error(`没有名为 ${name} 的应用工具，或当前未获授权。工具名见 load_application_tools 的说明，用它的 domains 可查看某个领域每个工具的用途。`)
        if (tool.exposure === 'model-only') throw new Error(`${name} 在工具列表里，直接调用。`)
        const outcome = await ctx.executeTool(name, input ?? {}, { signal })
        if (!outcome.isError) return outcome.result
        // 没看过定义就调用而失败时，把定义随错误一起给出，模型一轮内就能改对
        if (signal?.aborted || this.session().getActiveToolNames().includes(name) || this.definedInContext().has(name)) return { ...outcome.result, isError: true }
        return { content: [...outcome.result.content, { type: 'text', text: `${name} 的定义：${JSON.stringify(definitionOf(tool))}` }],
          details: { definedTools: [name] }, isError: true }
      },
    }
    // 标成 deferred 的工具不在原生列表里也能经 ctx.executeTool 调用
    const callable = tools.map(tool => this.deferred.includes(tool.name) ? { ...tool, exposure: 'deferred' as const } : tool)
    this.tools = [...(this.deferred.length ? [...callable, loader, dispatcher] : tools)].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    this.initialNames = this.namesForScope()
  }

  private namesForScope(): string[] {
    const baseline = new Set(surfaceProfile(this.scope).tools)
    return this.tools.filter(tool => !this.deferred.includes(tool.name) || baseline.has(tool.name)).map(tool => tool.name)
  }

  private directory(domain: string): string[] {
    const extra = new Set([...domainProfiles[domain]?.tools ?? [], ...sharedDomainTools[domain] ?? []])
    return this.tools.filter(tool => this.deferred.includes(tool.name) && (domainOf(tool.name) === domain || extra.has(tool.name)))
      .map(tool => `${tool.name}：${purposeOf(tool)}`)
  }

  /** 定义仍在模型上下文里的工具。对话压缩后较早的工具结果不在消息里，按没看过处理。 */
  private definedInContext(): Set<string> {
    const names = new Set<string>()
    for (const message of this.session().messages) {
      if (message.role !== 'toolResult') continue
      const defined = (message.details as { definedTools?: unknown } | undefined)?.definedTools
      if (Array.isArray(defined)) for (const name of defined) if (typeof name === 'string') names.add(name)
    }
    return names
  }

  private load(request: LoadRequest): ToolResult {
    if (request.task && !Object.hasOwn(taskProfiles, request.task)) throw new Error('未知任务类型，请使用加载工具列出的任务。')
    const names = request.names ?? []
    if (!names.length && !request.task && !request.domains?.length) throw new Error('请用 names 点名要加载的工具（各领域工具名见加载工具的说明），或用 domains 查看某个领域的工具用途。')
    const unknown = names.filter(name => !this.tools.some(tool => tool.name === name))
    if (unknown.length) throw new Error(`工具未获授权或不存在：${unknown.join('、')}；请读取当前应用契约。`)
    const task = request.task ? taskProfiles[request.task] : undefined
    const requested = new Set([...names, ...(task?.tools ?? [])])
    const selected = this.tools.filter(tool => requested.has(tool.name))
    const active = new Set(this.session().getActiveToolNames())
    const defined = this.definedInContext()
    const declaredTools = selected.filter(tool => active.has(tool.name)).map(tool => tool.name)
    const loadedEarlier = selected.filter(tool => !active.has(tool.name) && defined.has(tool.name)).map(tool => tool.name)
    const fresh = selected.filter(tool => !active.has(tool.name) && !defined.has(tool.name))
    const unavailableTools = task ? task.tools.filter(name => !this.tools.some(tool => tool.name === name)) : []
    const directory = (request.domains ?? []).map(domain => ({ domain, tools: this.directory(domain) }))
    const guidance = [
      ...(fresh.length || loadedEarlier.length ? [`tools${loadedEarlier.length ? ' 与 loadedEarlier（定义在前文）' : ''} 里的工具用 ${APPLICATION_TOOL_DISPATCHER} 调用：name 填工具名，input 按该工具的 parameters 填写。`] : []),
      ...(declaredTools.length ? ['declaredTools 已在工具列表里，直接调用。'] : []),
      task?.guidance ?? (selected.length ? '普通读改增删继续使用通用实体。'
        : '以上是领域工具目录，尚未加载；用 names 一次列齐本步要用的再加载。普通读改增删继续使用通用实体。'),
      ...(request.domains ?? []).flatMap(domain => domainProfiles[domain]?.guidance ?? []),
    ].join('\n')
    return { content: [{ type: 'text', text: JSON.stringify({ tools: fresh.map(definitionOf),
      ...(declaredTools.length ? { declaredTools } : {}), ...(loadedEarlier.length ? { loadedEarlier } : {}),
      ...(directory.length ? { directory } : {}),
      ...(unavailableTools.length ? { unavailableTools, limitation: '未提供的工具当前未获授权或宿主不可用，重复加载不会恢复。' } : {}),
      guidance,
    }) }], details: { definedTools: fresh.map(tool => tool.name) } }
  }

  /**
   * 模型直接按名调用了没进工具列表的应用工具时，Pi 只回“not found”。发给模型前换成改道说明；
   * 只看消息本身，同一条消息每次请求都得到同样的文字。
   */
  redirectUndeclaredCalls(messages: AgentMessage[]): AgentMessage[] {
    return messages.map((message) => {
      if (message.role !== 'toolResult' || !message.isError || !this.deferred.includes(message.toolName)) return message
      const text = message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('')
      if (text !== `Tool ${message.toolName} not found`) return message
      return { ...message, content: [{ type: 'text' as const, text: `${message.toolName} 不在工具列表里，不能直接调用。用 ${APPLICATION_TOOL_DISPATCHER} 调用：name 填 ${message.toolName}，input 填它的参数；参数不清楚先用 load_application_tools 的 names 取得。` }] }
    })
  }

  prepareContext(context: string): string {
    this.scope = disclosureSurface(context)
    this.session().setActiveToolsByName(this.namesForScope())
    return surfaceProfile(this.scope).guidance
  }
}
