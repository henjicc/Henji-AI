import type { AgentSession, SessionManager, ToolDefinition } from '@earendil-works/pi-coding-agent'

const imageEditTools = new Set(['create_image_edit_preview', 'commit_image_edit'])
const entryType = 'henji-loaded-image-edit-tools'

/** 仅延迟完整参数定义；注册工具仍来自宿主授权目录，不增加业务权限。 */
export class PiToolDisclosure {
  readonly tools: ToolDefinition[]
  readonly initialNames: string[]
  private readonly deferred: string[]

  constructor(tools: ToolDefinition[], private readonly manager: SessionManager, private readonly session: () => AgentSession) {
    this.deferred = tools.filter(tool => imageEditTools.has(tool.name)).map(tool => tool.name)
    const restored = manager.getBranch().some(entry => entry.type === 'custom' && entry.customType === entryType)
    const loader: ToolDefinition = { name: 'load_application_tools', label: '准备图片编辑',
      description: `需要图片编辑预览或保存时先调用一次；启用 ${this.deferred.join('、')} 的完整参数。普通生成、画布节点和查询工具已直接可用。仅加载当前已授权工具。`,
      parameters: { type: 'object', properties: {}, additionalProperties: false } as ToolDefinition['parameters'],
      executionMode: 'sequential',
      execute: async () => ({ content: [{ type: 'text', text: JSON.stringify({ availableTools: this.activate() }) }], details: {} }),
    }
    this.tools = this.deferred.length ? [...tools, loader] : tools
    this.initialNames = this.tools.filter(tool => restored || !imageEditTools.has(tool.name)).map(tool => tool.name)
  }

  activate(): string[] {
    if (!this.deferred.length) return []
    const session = this.session()
    const active = session.getActiveToolNames()
    if (this.deferred.some(name => !active.includes(name))) {
      session.setActiveToolsByName([...new Set([...active, ...this.deferred])])
      this.manager.appendCustomEntry(entryType, { loaded: true })
    }
    return this.deferred
  }

  prepareContext(context: string): void {
    let value: { surface?: { id?: string } } | null
    try { value = JSON.parse(context) as typeof value } catch { return }
    if (value?.surface?.id === 'tool.image_edit') this.activate()
  }
}
