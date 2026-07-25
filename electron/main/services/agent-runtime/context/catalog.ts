import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from './types'

const toolsByDomain: Readonly<Record<string, string[]>> = {
  catalog: ['search_application_capabilities'],
  navigation: ['switch_workspace'],
  models: ['search_models', 'get_model_schema'],
  generation: ['prepare_generation_task', 'create_visible_generation_task', 'get_generation_task', 'cancel_generation_task'],
  user_instructions: ['get_user_instructions', 'update_user_instructions'],
  memory: [
    'list_agent_memories',
    'propose_agent_memory',
    'confirm_agent_memory',
    'reject_agent_memory',
  ],
  diagnostics: ['query_diagnostic_events'],
  canvas: [
    'list_canvas_projects',
    'get_canvas_node',
    'open_canvas_project',
    'create_canvas_project',
    'close_canvas_project',
    'rename_canvas_project',
    'delete_canvas_project',
    'search_canvas_node_types',
    'get_canvas_node_schema',
    'add_canvas_node',
    'add_asset_to_canvas',
    'duplicate_canvas_node',
    'update_canvas_node',
    'delete_canvas_nodes',
    'select_canvas_node',
    'group_canvas_nodes',
    'connect_canvas_nodes',
    'disconnect_canvas_edge',
    'focus_canvas_node',
    'undo_canvas_change',
    'plan_canvas_batch',
    'preview_canvas_batch',
    'commit_canvas_batch',
  ],
  toolbox: ['list_toolbox_tools', 'get_toolbox_state', 'select_toolbox_tool'],
  camera_stage: [
    'list_camera_stage_projects',
    'get_camera_stage_project',
    'open_camera_stage_project',
    'create_camera_stage_project',
    'rename_camera_stage_project',
    'delete_camera_stage_project',
    'add_camera_stage_object',
    'duplicate_camera_stage_object',
    'delete_camera_stage_object',
    'update_camera_stage_object',
    'add_camera_stage_shot',
    'update_camera_stage_shot',
  ],
  storyboard: ['list_storyboard_projects', 'get_storyboard_project'],
  image_edit: ['create_image_edit_preview', 'commit_image_edit'],
  assets: [
    'query_assets',
    'get_asset',
    'list_asset_libraries',
    'list_asset_tags',
    'select_asset',
    'set_asset_tags',
    'add_asset_to_library',
    'remove_asset_from_library',
    'delete_asset',
    'add_asset_to_canvas',
  ],
  workflows: [
    'list_workflows',
    'plan_workflow',
    'execute_workflow',
    'get_workflow_run',
    'pause_workflow',
    'resume_workflow',
    'cancel_workflow',
    'rollback_workflow',
  ],
}

export class AgentToolCatalogPlanner {
  private discoveredToolNames: string[] = []

  constructor(private readonly registry: AgentToolRegistry) {}

  select(route: AgentRouteDecision, context: HostContextSnapshot | null): AgentToolRegistration[] {
    const directDomains = route.toolDomains.filter((domain) => domain !== 'catalog')
    const requested = directDomains.flatMap((domain) => toolsByDomain[domain] ?? [])
    const needsCapabilityDiscovery = requested.length === 0
    const names = [
      ...requested,
      ...this.discoveredToolNames,
      ...(needsCapabilityDiscovery ? ['search_application_capabilities'] : []),
    ]
    return this.registry.registrations([...new Set(names)].slice(0, 8), context)
  }

  rememberDiscovered(toolName: string, output: unknown): string[] {
    if (toolName !== 'search_application_capabilities' || !output || typeof output !== 'object') return []
    const capabilities = (output as Record<string, unknown>).capabilities
    if (!Array.isArray(capabilities)) return []
    const previous = new Set(this.discoveredToolNames)
    const candidates: string[] = []
    for (const capability of capabilities) {
      if (!capability || typeof capability !== 'object' || Array.isArray(capability)) continue
      const name = (capability as Record<string, unknown>).name
      if (typeof name !== 'string' || name === 'search_application_capabilities') continue
      if (!this.registry.get(name) || candidates.includes(name)) continue
      candidates.push(name)
      if (candidates.length >= 20) break
    }
    this.discoveredToolNames = [...new Set([...candidates, ...this.discoveredToolNames])].slice(0, 20)
    return candidates.filter((name) => !previous.has(name))
  }
}
