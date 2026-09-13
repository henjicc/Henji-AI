import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/assistant/builtinApplicationCapabilityRegistry'

import { basicTools, disclosureSurface, surfaceProfile, taskProfiles } from './toolDisclosureProfiles'

const entryType = 'henji-loaded-application-tools'
type LoadRequest = { domains?: string[]; names?: string[]; task?: keyof typeof taskProfiles }
const domainOf = (name: string) => BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.domain

/** 注册目录保持完整授权集合，模型按消息原界面接收基础及已明确加载的工具。 */
export class PiToolDisclosure {
  readonly tools: ToolDefinition[]
  readonly initialNames: string[]
  private readonly deferred: string[]
  private scope = 'workspace.unknown'
  private readonly restored = new Map<string, Set<string>>()

  constructor(tools: ToolDefinition[], private readonly manager: SessionManager, private readonly session: () => AgentSession) {
    this.deferred = tools.filter(tool => !basicTools.has(tool.name) && (domainOf(tool.name)
      || ['describe_application_contract', 'read_application_media', 'get_application_operation', 'retry_application_operation_save'].includes(tool.name))).map(tool => tool.name)
    for (const entry of manager.getBranch()) {
      if (entry.type !== 'custom') continue
      if (entry.customType === 'henji-loaded-image-edit-tools') this.remember('tool.image_edit', this.deferred.filter(name => domainOf(name) === 'image_edit'))
      if (entry.customType === entryType) {
        const data = entry.data as { names?: unknown; scope?: unknown } | undefined
        if (Array.isArray(data?.names)) this.remember(typeof data.scope === 'string' ? data.scope : 'workspace.unknown',
          data.names.filter((name): name is string => typeof name === 'string'))
      }
    }
    const domains = [...new Set(this.deferred.map(domainOf).filter((domain): domain is string => Boolean(domain)))]
    const loader: ToolDefinition = { name: 'load_application_tools', label: '加载应用工具',
      description: `按任务一次加载相关工具，或按领域/工具名加载。任务：canvas_generation（画布生成）、canvas_nodes（节点详情）、generation（生成页）。领域：${domains.join('、')}。返回流程说明，下一轮即可调用。只加载已授权工具；无参数兼容图片编辑。`,
      parameters: { type: 'object', properties: {
        task: { type: 'string', enum: Object.keys(taskProfiles) },
        domains: { type: 'array', items: { type: 'string', enum: domains }, maxItems: 16 },
        names: { type: 'array', items: { type: 'string' }, maxItems: 32 },
      }, additionalProperties: false } as ToolDefinition['parameters'],
      executionMode: 'sequential',
      execute: async (_id, args) => {
        const request = args as LoadRequest
        const availableTools = this.activate(request)
        const unavailableTools = request.task ? taskProfiles[request.task].tools.filter(name => !this.tools.some(tool => tool.name === name)) : []
        return { content: [{ type: 'text', text: JSON.stringify({ availableTools, unavailableTools,
          guidance: request.task ? taskProfiles[request.task].guidance : '工具已加载；参数以工具 schema 为准，普通读改增删继续使用通用实体。',
          ...(unavailableTools.length ? { limitation: '未提供的工具当前未获授权或宿主不可用，重复加载不会恢复。只调用 availableTools 中的工具。' } : {}),
        }) }], details: {} }
      },
    }
    this.tools = this.deferred.length ? [...tools, loader] : tools
    this.initialNames = this.namesForScope()
  }

  private remember(scope: string, names: string[]): void {
    this.restored.set(scope, new Set([...(this.restored.get(scope) ?? []), ...names]))
  }

  private namesForScope(): string[] {
    const selected = new Set([...surfaceProfile(this.scope).tools, ...(this.restored.get(this.scope) ?? [])])
    return this.tools.filter(tool => !this.deferred.includes(tool.name) || selected.has(tool.name)).map(tool => tool.name)
  }

  activate(request: LoadRequest = {}): string[] {
    if (request.task && !Object.hasOwn(taskProfiles, request.task)) throw new Error('未知任务类型，请使用加载工具列出的任务。')
    const domains = request.domains ?? (request.names?.length || request.task ? [] : ['image_edit'])
    const names = request.names ?? []
    const unknown = names.filter(name => !this.tools.some(tool => tool.name === name))
    if (unknown.length) throw new Error(`工具未获授权或不存在：${unknown.join('、')}；请读取当前应用契约。`)
    const requested = new Set([...names, ...(request.task ? taskProfiles[request.task].tools : [])])
    const selected = this.tools.filter(tool => requested.has(tool.name) || domains.includes(domainOf(tool.name) ?? '')).map(tool => tool.name)
    if (!selected.length) return []
    const session = this.session()
    const active = session.getActiveToolNames()
    if (selected.some(name => !active.includes(name))) {
      this.remember(this.scope, selected)
      session.setActiveToolsByName([...new Set([...active, ...selected])])
      this.manager.appendCustomEntry(entryType, { scope: this.scope, names: selected })
    }
    return selected
  }

  prepareContext(context: string): string {
    this.scope = disclosureSurface(context)
    this.session().setActiveToolsByName(this.namesForScope())
    return surfaceProfile(this.scope).guidance
  }
}
