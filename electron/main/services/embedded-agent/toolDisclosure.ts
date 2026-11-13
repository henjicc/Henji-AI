import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { isPaidCapability } from '../application-runtime/toolCatalog'
import { estimateContextTokens } from './contextBudget'

import { basicTools, disclosureSurface, domainProfiles, surfaceProfile, taskProfiles } from './toolDisclosureProfiles'

const entryType = 'henji-loaded-application-tools'
type LoadRequest = { domains?: string[]; names?: string[]; task?: keyof typeof taskProfiles }
const domainOf = (name: string) => BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.domain

/** 目录里每个工具只给一句用途：说明的第一句，不截断半句。 */
function purposeOf(tool: ToolDefinition): string {
  const first = /^(.+?[。；！？])/.exec(tool.description)?.[1] ?? tool.description
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(tool.name)
  return definition && isPaidCapability(definition) ? `${first}（付费）` : first
}

/** 上一条用户消息之后实际调用过的工具。 */
function calledInLastMessage(messages: AgentSession['messages']): Set<string> {
  const called = new Set<string>()
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === 'user') break
    if (message.role !== 'assistant') continue
    for (const part of message.content) if (part.type === 'toolCall') called.add(part.name)
  }
  return called
}

/**
 * 注册目录保持完整授权集合，模型按消息原界面接收基础及已明确加载的工具。
 *
 * 取舍（依据见 tickets/46-正式使用链路/result-助手信息精简.md）：
 * - 只按工具名或任务加载，按领域只返回目录。整领域加载剪辑一次带上 90 个工具、约十万 token，而真实会话里用到的只有两三个。
 * - 已加载的工具跨消息保留，新加载的由 Pi 接在末尾。工具定义排在历史之前，收回任何一个都会让其后的整段历史按未命中重算：
 *   DeepSeek 未命中单价是命中的 50 倍，收回几千 token 的工具换来的节省，要几十上百次请求才抵得上那一次重算。
 * - 已加载的工具按 estimateContextTokens 估算超过窗口的 1/8 时（这个估算偏高 1.5–2 倍，实际约为窗口的 1/12–1/16），
 *   在下一条用户消息开始处只保留上一条消息里调用过的：这时窗口与注意力的代价已大过一次重算。
 */
export class PiToolDisclosure {
  readonly tools: ToolDefinition[]
  readonly initialNames: string[]
  private readonly deferred: string[]
  private scope = 'workspace.unknown'
  private readonly restored = new Map<string, Set<string>>()

  constructor(tools: ToolDefinition[], private readonly manager: SessionManager, private readonly session: () => AgentSession,
    private readonly loadedToolBudget: number) {
    this.deferred = tools.filter(tool => !basicTools.has(tool.name) && (domainOf(tool.name)
      || ['describe_application_contract', 'read_application_media', 'get_application_operation', 'retry_application_operation_save', 'review_application_operation'].includes(tool.name))).map(tool => tool.name)
    for (const entry of manager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== entryType) continue
      const data = entry.data as { names?: unknown; scope?: unknown; replace?: unknown } | undefined
      if (!Array.isArray(data?.names)) continue
      const scope = typeof data.scope === 'string' ? data.scope : 'workspace.unknown'
      const names = data.names.filter((name): name is string => typeof name === 'string')
      if (data.replace === true) this.restored.set(scope, new Set(names))
      else this.remember(scope, names)
    }
    const domains = [...new Set(this.deferred.map(domainOf).filter((domain): domain is string => Boolean(domain)))].sort()
    // 说明里列出各领域的工具名，模型才能一步按名加载，不必先查目录。
    const ungrouped = this.deferred.filter(name => !domainOf(name)).sort()
    const namesByDomain = [...domains.map(domain => `${domain}：${this.deferred.filter(name => domainOf(name) === domain).sort().join(',')}`),
      ...(ungrouped.length ? [`其他：${ungrouped.join(',')}`] : [])].join('；')
    const loader: ToolDefinition = { name: 'load_application_tools', label: '加载应用工具',
      description: `加载专用工具，下一轮即可调用。names：一次列齐本步要用的工具名；task：按任务一次加载一组，canvas_generation（画布生成）、canvas_nodes（节点详情）、generation（生成页）；domains：只返回该领域每个工具的一句用途和做法，不加载，不确定用哪个工具时先查。已加载的工具后续消息仍可用，不必重复加载。各领域工具名：${namesByDomain}。`,
      parameters: { type: 'object', properties: {
        task: { type: 'string', enum: Object.keys(taskProfiles) },
        domains: { type: 'array', items: { type: 'string', enum: domains }, maxItems: 16 },
        names: { type: 'array', items: { type: 'string' }, maxItems: 32 },
      }, additionalProperties: false } as ToolDefinition['parameters'],
      executionMode: 'sequential',
      execute: async (_id, args) => {
        const request = args as LoadRequest
        const directory = (request.domains ?? []).map(domain => ({ domain, tools: this.directory(domain) }))
        const availableTools = this.activate(request)
        const unavailableTools = request.task ? taskProfiles[request.task].tools.filter(name => !this.tools.some(tool => tool.name === name)) : []
        const domainGuidance = (request.domains ?? []).flatMap(domain => domainProfiles[domain]?.guidance ?? [])
        const guidance = request.task ? taskProfiles[request.task].guidance
          : availableTools.length ? '工具已加载；参数以工具 schema 为准，普通读改增删继续使用通用实体。'
            : '以上是领域工具目录，尚未加载；用 names 一次列齐本步要用的再加载。普通读改增删继续使用通用实体。'
        return { content: [{ type: 'text', text: JSON.stringify({ availableTools, ...(directory.length ? { directory } : {}), unavailableTools,
          guidance: [guidance, ...domainGuidance].join('\n'),
          ...(unavailableTools.length ? { limitation: '未提供的工具当前未获授权或宿主不可用，重复加载不会恢复。只调用 availableTools 中的工具。' } : {}),
        }) }], details: {} }
      },
    }
    this.tools = [...(this.deferred.length ? [...tools, loader] : tools)].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    this.initialNames = this.namesForScope()
  }

  private remember(scope: string, names: string[]): void {
    this.restored.set(scope, new Set([...(this.restored.get(scope) ?? []), ...names]))
  }

  private namesForScope(): string[] {
    const selected = new Set([...surfaceProfile(this.scope).tools, ...(this.restored.get(this.scope) ?? [])])
    return this.tools.filter(tool => !this.deferred.includes(tool.name) || selected.has(tool.name)).map(tool => tool.name)
  }

  private directory(domain: string): string[] {
    const extra = new Set(domainProfiles[domain]?.tools ?? [])
    return this.tools.filter(tool => this.deferred.includes(tool.name) && (domainOf(tool.name) === domain || extra.has(tool.name)))
      .map(tool => `${tool.name}：${purposeOf(tool)}`)
  }

  activate(request: LoadRequest = {}): string[] {
    if (request.task && !Object.hasOwn(taskProfiles, request.task)) throw new Error('未知任务类型，请使用加载工具列出的任务。')
    const names = request.names ?? []
    if (!names.length && !request.task && !request.domains?.length) throw new Error('请用 names 点名要加载的工具（各领域工具名见加载工具的说明），或用 domains 查看某个领域的工具用途。')
    const unknown = names.filter(name => !this.tools.some(tool => tool.name === name))
    if (unknown.length) throw new Error(`工具未获授权或不存在：${unknown.join('、')}；请读取当前应用契约。`)
    const requested = new Set([...names, ...(request.task ? taskProfiles[request.task].tools : [])])
    const selected = this.tools.filter(tool => requested.has(tool.name)).map(tool => tool.name)
    if (!selected.length) return []
    const session = this.session()
    const active = session.getActiveToolNames()
    if (selected.some(name => !active.includes(name))) {
      this.remember(this.scope, selected)
      const enabled = new Set([...active, ...selected])
      session.setActiveToolsByName(this.tools.filter(tool => enabled.has(tool.name)).map(tool => tool.name))
      this.manager.appendCustomEntry(entryType, { scope: this.scope, names: selected })
    }
    return selected
  }

  /** 已加载的工具超出预算时，只留上一条消息里调用过的；在用户消息开始处做，一次重算换之后每次请求都变短。 */
  private reclaimOverBudget(): void {
    const loaded = this.restored.get(this.scope)
    if (!loaded?.size) return
    const baseline = new Set(surfaceProfile(this.scope).tools)
    const extra = this.tools.filter(tool => loaded.has(tool.name) && !baseline.has(tool.name))
      .map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
    if (estimateContextTokens(JSON.stringify(extra)) <= this.loadedToolBudget) return
    const called = calledInLastMessage(this.session().messages)
    const kept = [...loaded].filter(name => called.has(name))
    // 上一条消息把已加载的都用过时没有可收回的，不写重复记录
    if (kept.length === loaded.size) return
    this.restored.set(this.scope, new Set(kept))
    this.manager.appendCustomEntry(entryType, { scope: this.scope, names: kept, replace: true })
  }

  prepareContext(context: string): string {
    this.scope = disclosureSurface(context)
    this.reclaimOverBudget()
    this.session().setActiveToolsByName(this.namesForScope())
    return surfaceProfile(this.scope).guidance
  }
}
