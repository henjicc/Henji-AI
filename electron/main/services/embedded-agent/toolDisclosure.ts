import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/assistant/builtinApplicationCapabilityRegistry'

// 仅为首轮展示策略，不决定 MCP 能否调用；新增业务工具默认按领域延迟加载。
const frequentTools = new Set([
  'describe_application_entities', 'list_application_entities', 'read_application_entity', 'change_application_entities',
  'search_models', 'get_model_schema', 'prepare_generation_task', 'create_visible_generation_task', 'get_generation_task',
  'cancel_generation_task', 'prepare_canvas_node_generation', 'submit_canvas_node_generation', 'resume_canvas_generation_task',
  'apply_canvas_image_capability', 'add_generation_result_to_canvas', 'render_camera_stage_output', 'get_camera_stage_render_task',
  'cancel_camera_stage_render_task', 'get_current_application_context', 'open_application_surface',
])
const entryType = 'henji-loaded-application-tools'
const legacyEntryType = 'henji-loaded-image-edit-tools'
const domainOf = (name: string) => BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(name)?.domain

/** 注册目录保持完整授权集合，模型只接收高频及已明确加载的工具。 */
export class PiToolDisclosure {
  readonly tools: ToolDefinition[]
  readonly initialNames: string[]
  private readonly deferred: string[]

  constructor(tools: ToolDefinition[], private readonly manager: SessionManager, private readonly session: () => AgentSession) {
    this.deferred = tools.filter(tool => domainOf(tool.name) && !frequentTools.has(tool.name)).map(tool => tool.name)
    const restored = new Set<string>()
    for (const entry of manager.getBranch()) {
      if (entry.type !== 'custom') continue
      if (entry.customType === legacyEntryType) this.deferred.filter(name => domainOf(name) === 'image_edit').forEach(name => restored.add(name))
      if (entry.customType === entryType) {
        const data = entry.data as { names?: unknown } | undefined
        if (Array.isArray(data?.names)) data.names.forEach(name => { if (typeof name === 'string') restored.add(name) })
      }
    }
    const domains = [...new Set(this.deferred.map(domainOf).filter((domain): domain is string => Boolean(domain)))]
    const loader: ToolDefinition = { name: 'load_application_tools', label: '加载应用工具',
      description: `按业务领域或工具名加载完整参数。可用领域：${domains.join('、')}。生成与通用实体工具已直接可用；不传参数兼容加载图片编辑。只启用当前已授权工具。`,
      parameters: { type: 'object', properties: {
        domains: { type: 'array', items: { type: 'string', enum: domains }, maxItems: 16 },
        names: { type: 'array', items: { type: 'string' }, maxItems: 32 },
      }, additionalProperties: false } as ToolDefinition['parameters'],
      executionMode: 'sequential',
      execute: async (_id, args) => {
        const request = args as { domains?: string[]; names?: string[] }
        const availableTools = this.activate(request)
        return { content: [{ type: 'text', text: JSON.stringify({ availableTools }) }], details: {} }
      },
    }
    this.tools = this.deferred.length ? [...tools, loader] : tools
    this.initialNames = this.tools.filter(tool => !this.deferred.includes(tool.name) || restored.has(tool.name)).map(tool => tool.name)
  }

  activate(request: { domains?: string[]; names?: string[] } = {}): string[] {
    const domains = request.domains ?? (request.names?.length ? [] : ['image_edit'])
    const names = request.names ?? []
    const unknown = names.filter(name => !this.tools.some(tool => tool.name === name))
    if (unknown.length) throw new Error(`工具未获授权或不存在：${unknown.join('、')}；请读取当前应用契约。`)
    const selected = this.deferred.filter(name => names.includes(name) || domains.includes(domainOf(name) ?? ''))
    if (!selected.length) return []
    const session = this.session()
    const active = session.getActiveToolNames()
    if (selected.some(name => !active.includes(name))) {
      session.setActiveToolsByName([...new Set([...active, ...selected])])
      this.manager.appendCustomEntry(entryType, { names: selected })
    }
    return selected
  }

  prepareContext(context: string): void {
    let value: { surface?: { id?: string } } | null
    try { value = JSON.parse(context) as typeof value } catch { return }
    if (value?.surface?.id === 'tool.image_edit') this.activate()
  }
}
