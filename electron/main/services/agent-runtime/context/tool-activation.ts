import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from './types'

// 预算的唯一来源在 core，事件契约与保存点契约共用同一份，改一处即可。
import {
  AGENT_ACTIVE_TOOL_LIMIT,
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_TOOL_SCHEMA_BUDGET_BYTES,
} from '../../../../../src/core/assistant/toolBudget'

export { AGENT_ACTIVE_TOOL_LIMIT, AGENT_TOOL_SCHEMA_BUDGET_BYTES }

const CAPABILITY_DISCOVERY_TOOL = 'discover_application_capabilities'
const CURRENT_CONTEXT_TOOL = 'get_current_application_context'
/**
 * 技能加载必须和能力发现一样常驻。
 *
 * 它的 domain 是 `application`，如果只靠 `route.toolDomains` 命中，那么一个三维任务
 * （toolDomains = camera_stage / navigation）根本拿不到这个工具——而 `skills_index` 层
 * 又在告诉模型"先用 load_assistant_skill 加载对应技能"，系统提示词同时规定"只能调用本轮
 * 提供的工具"。两条一起生效的结果就是：模型看得见技能清单，却永远调不动，整套技能系统
 * 等于死代码。实测就是这么坏的。
 */
const SKILL_LOAD_TOOL = 'load_assistant_skill'

/**
 * 反射层的通用动词同样必须常驻，理由和 `load_assistant_skill` 一模一样。
 *
 * 它们的 domain 是 `application`，而 `directNames` 只取 `route.toolDomains` 里的类别——三维
 * 任务的 toolDomains 是 camera_stage / toolbox，永远不含 application。于是这些"任何领域都要用
 * 的基础动词"只能靠能力发现轮换露面，实测的结果是模型报"当前工具集没有对象关键帧写入能力"，
 * 而那个能力其实已经注册好了。
 *
 * 通用动词是地板，不是候选：没有它们，助手连"这个东西能不能改"都问不出来。
 */
const REFLECTION_TOOLS = [
  'declare_action_plan',
  'describe_application_entities',
  'change_application_entities',
  'list_application_entities',
  'read_application_entity',
]

// 工具结果被上下文预算卸载后，artifactRef 只能由这个工具回读。把它作为核心地板，
// 避免模型为了读取系统刚产生的产物而虚构一个不在 Task Graph 前沿里的 artifacts Facet。
const ARTIFACT_READ_TOOL = 'read_agent_artifact'

/** 只要任务启用了应用工具域，这些能力就是固定地板，不参与目录轮换。 */
export const AGENT_CORE_TOOL_NAMES = [
  SKILL_LOAD_TOOL,
  CURRENT_CONTEXT_TOOL,
  CAPABILITY_DISCOVERY_TOOL,
  ARTIFACT_READ_TOOL,
  ...REFLECTION_TOOLS,
] as const

export interface AgentToolActivationInput {
  route: AgentRouteDecision
  context: HostContextSnapshot | null
  pinnedToolNames: string[]
  leasedToolNames: string[]
  recentToolNames: string[]
  closeoutMode?: boolean
  /**
   * 已经用过的排列顺序。工具 schema 也在供应商的缓存前缀里，顺序一变整段前缀作废。
   *
   * 候选顺序里混着 `recentToolNames`，模型每用一个工具就把它顶到前面，于是活动工具数组
   * 每轮都在重排——集合没变，顺序变了，缓存照样全丢。这里让已出现过的工具保持原位，
   * 新工具一律追加到末尾，数组因此是只增不改的。
   */
  stableOrder?: string[]
}

export interface AgentToolActivationSnapshot {
  registrations: AgentToolRegistration[]
  activeToolNames: string[]
  schemaBytes: number
  descriptionBytes: number
  candidateCount: number
  pinnedToolNames: string[]
  droppedPinnedToolNames: string[]
  leasedToolNames: string[]
  droppedLeasedToolNames: string[]
  droppedForCount: string[]
  droppedForSchemaBudget: string[]
  unavailableNames: string[]
}

function registrationBytes(registration: AgentToolRegistration): number {
  return Buffer.byteLength(JSON.stringify(registration.modelTool), 'utf8')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/**
 * 发现工具在输出 `leasedToolNames` 前先按下一轮的硬预算预筛。核心地板先占位，
 * 因而这里承诺的名字不会随后因为 32/96KB 门禁被静默驱逐；其余候选明确进入 deferred。
 */
export function selectLeaseableToolNames(
  registry: AgentToolRegistry,
  context: HostContextSnapshot | null,
  candidates: string[]
): { leasedToolNames: string[]; deferredToolNames: string[] } {
  const core = registry.registrations([...AGENT_CORE_TOOL_NAMES], context)
  let count = core.length
  let bytes = core.reduce((total, registration) => total + registrationBytes(registration), 0)
  const coreNames = new Set(core.map((registration) => registration.catalog.name))
  const leasedToolNames: string[] = []
  const deferredToolNames: string[] = []
  for (const name of unique(candidates)) {
    if (coreNames.has(name)) continue
    const registration = registry.registrations([name], context)[0]
    if (!registration) continue
    const nextBytes = bytes + registrationBytes(registration)
    if (
      leasedToolNames.length >= AGENT_DISCOVERY_LEASE_TOOL_LIMIT
      || count + 1 > AGENT_ACTIVE_TOOL_LIMIT
      || nextBytes > AGENT_TOOL_SCHEMA_BUDGET_BYTES
    ) {
      deferredToolNames.push(name)
      continue
    }
    leasedToolNames.push(name)
    count += 1
    bytes = nextBytes
  }
  return { leasedToolNames, deferredToolNames }
}

export function activateAgentTools(
  registry: AgentToolRegistry,
  input: AgentToolActivationInput
): AgentToolActivationSnapshot {
  const available = registry.list(input.context)
  const availableNames = new Set(available.map((entry) => entry.name))
  const directCategories = input.route.toolDomains.filter((domain) => domain !== 'catalog')
  const preferredAnchorByCategory: Readonly<Record<string, string>> = {
    models: 'search_models',
    generation: 'create_visible_generation_task',
    navigation: 'switch_workspace',
  }
  const namesByCategory = directCategories.map((category) => available
    .filter((entry) => entry.category === category)
    .map((entry) => entry.name))
  const directNames = unique([
    ...directCategories.flatMap((category, index) => {
      const names = namesByCategory[index] ?? []
      const preferred = preferredAnchorByCategory[category]
      return preferred && names.includes(preferred) ? [preferred] : names.slice(0, 1)
    }),
    ...namesByCategory.flat(),
  ]).slice(0, 4)
  const capabilitySearchNames = input.route.toolDomains.length === 0
    ? []
    : input.closeoutMode
      ? [CURRENT_CONTEXT_TOOL]
      : [CURRENT_CONTEXT_TOOL, CAPABILITY_DISCOVERY_TOOL]
  // 技能加载排在能力发现之前：领域知识决定后面怎么发现和调用能力，顺序反了没有意义。
  const skillNames = input.route.toolDomains.length === 0 ? [] : [SKILL_LOAD_TOOL]
  const reflectionNames = input.route.toolDomains.length === 0 ? [] : REFLECTION_TOOLS
  const artifactNames = input.route.toolDomains.length === 0 ? [] : [ARTIFACT_READ_TOOL]
  /*
   * 顺序即优先级，超出 AGENT_ACTIVE_TOOL_LIMIT 的部分会被直接丢掉。
   *
   * 核心工具固定约 8 个；恢复工具最多 4 个；活动 Facet 租约最多 15 个；路由锚点最多 4 个。
   * 租约排在路由锚点和最近工具之前，目录扩张时只延迟新候选，不能静默驱逐执行中的工作集。
   */
  const candidates = unique([
    ...skillNames,
    ...capabilitySearchNames,
    ...artifactNames,
    // 通用动词排在 recent/discovered 之前：它们是地板，不参与轮换
    ...reflectionNames,
    ...input.leasedToolNames,
    ...input.pinnedToolNames,
    ...directNames,
    ...input.recentToolNames,
  ])
  const unavailableNames = candidates.filter((name) => !availableNames.has(name))
  const availableCandidates = candidates.filter((name) => availableNames.has(name))
  const registrations = registry.registrations(availableCandidates, input.context)
  const active: AgentToolRegistration[] = []
  const droppedForCount: string[] = []
  const droppedForSchemaBudget: string[] = []
  let schemaBytes = 0

  for (const registration of registrations) {
    const bytes = registrationBytes(registration)
    if (active.length >= AGENT_ACTIVE_TOOL_LIMIT) {
      droppedForCount.push(registration.catalog.name)
      continue
    }
    if (schemaBytes + bytes > AGENT_TOOL_SCHEMA_BUDGET_BYTES) {
      droppedForSchemaBudget.push(registration.catalog.name)
      continue
    }
    active.push(registration)
    schemaBytes += bytes
  }

  const active_ = active
  const orderIndex = new Map((input.stableOrder ?? []).map((name, index) => [name, index]))
  active_.sort((left, right) => (
    (orderIndex.get(left.catalog.name) ?? Number.MAX_SAFE_INTEGER)
    - (orderIndex.get(right.catalog.name) ?? Number.MAX_SAFE_INTEGER)
  ))
  const activeToolNames = active.map((registration) => registration.catalog.name)
  const descriptionBytes = active.reduce((total, registration) => (
    total + Buffer.byteLength(registration.modelTool.description ?? '', 'utf8')
  ), 0)
  const activeNameSet = new Set(activeToolNames)
  const availablePinnedToolNames = unique(input.pinnedToolNames)
    .filter((name) => availableNames.has(name))
  const availableLeasedToolNames = unique(input.leasedToolNames)
    .filter((name) => availableNames.has(name))

  return {
    registrations: active,
    activeToolNames,
    schemaBytes,
    descriptionBytes,
    candidateCount: availableCandidates.length,
    pinnedToolNames: availablePinnedToolNames.filter((name) => activeNameSet.has(name)),
    droppedPinnedToolNames: availablePinnedToolNames.filter((name) => !activeNameSet.has(name)),
    leasedToolNames: availableLeasedToolNames.filter((name) => activeNameSet.has(name)),
    droppedLeasedToolNames: availableLeasedToolNames.filter((name) => !activeNameSet.has(name)),
    droppedForCount,
    droppedForSchemaBudget,
    unavailableNames,
  }
}
