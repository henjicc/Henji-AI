import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolRegistration } from '../tools/types'
import type { AgentToolRegistry } from '../tools/registry'
import type { AgentRouteDecision } from './types'

/**
 * 单轮活动工具数量上限。
 *
 * 真正的约束是下面那个字节预算，这个计数只是兜底。原值 8 定得过紧：实测一个三维任务
 * 有 26 个候选，8 个位里 3 个被常驻工具占掉，每轮要丢掉 18 个，而 schema 实际只用掉
 * 7~12KB——距离 48KB 还有约四倍余量。计数在字节预算远未触顶时就先卡死，模型于是把轮次
 * 都花在等工具轮回来上。
 *
 * 提到 16 之后，字节预算重新成为先生效的那一个，这也是它本该扮演的角色。
 */
export const AGENT_ACTIVE_TOOL_LIMIT = 16
export const AGENT_TOOL_SCHEMA_BUDGET_BYTES = 48 * 1024
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

export interface AgentToolActivationInput {
  route: AgentRouteDecision
  context: HostContextSnapshot | null
  pinnedToolNames: string[]
  discoveredToolNames: string[]
  recentToolNames: string[]
}

export interface AgentToolActivationSnapshot {
  registrations: AgentToolRegistration[]
  activeToolNames: string[]
  schemaBytes: number
  candidateCount: number
  pinnedToolNames: string[]
  droppedPinnedToolNames: string[]
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

export function activateAgentTools(
  registry: AgentToolRegistry,
  input: AgentToolActivationInput
): AgentToolActivationSnapshot {
  const available = registry.list(input.context)
  const availableNames = new Set(available.map((entry) => entry.name))
  const directCategories = input.route.toolDomains.filter((domain) => domain !== 'catalog')
  const directNames = directCategories.flatMap((category) => (
    available.filter((entry) => entry.category === category).map((entry) => entry.name)
  ))
  const capabilitySearchNames = input.route.toolDomains.length === 0
    ? []
    : [CURRENT_CONTEXT_TOOL, CAPABILITY_DISCOVERY_TOOL]
  // 技能加载排在能力发现之前：领域知识决定后面怎么发现和调用能力，顺序反了没有意义。
  const skillNames = input.route.toolDomains.length === 0 ? [] : [SKILL_LOAD_TOOL]
  /*
   * 顺序即优先级，超出 AGENT_ACTIVE_TOOL_LIMIT 的部分会被直接丢掉。
   *
   * `recentToolNames` 必须排在 `discoveredToolNames` **前面**。此前是反的，后果在实测里
   * 很清楚：一个三维任务发现了 26 个能力，每轮只有 8 个槽位，其中 3 个被常驻工具占掉，
   * 剩下 5 个全被轮换的 discovered 列表吃满，于是模型刚用过、下一步还要接着用的工具
   * （place_camera_stage_object）在下一轮就消失了，隔两三轮才轮回来一次。18 轮里它一直在
   * 等工具，而不是在干活。
   *
   * 轮换的意义是"让没见过的能力有机会露面"，不是"把正在用的工作集挤掉"。所以最近用过的
   * 优先留下，轮换只填剩余槽位。
   */
  const candidates = unique([
    ...input.pinnedToolNames,
    ...skillNames,
    ...capabilitySearchNames,
    ...input.recentToolNames,
    ...input.discoveredToolNames,
    ...directNames,
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

  const activeToolNames = active.map((registration) => registration.catalog.name)
  const activeNameSet = new Set(activeToolNames)
  const availablePinnedToolNames = unique(input.pinnedToolNames)
    .filter((name) => availableNames.has(name))

  return {
    registrations: active,
    activeToolNames,
    schemaBytes,
    candidateCount: availableCandidates.length,
    pinnedToolNames: availablePinnedToolNames.filter((name) => activeNameSet.has(name)),
    droppedPinnedToolNames: availablePinnedToolNames.filter((name) => !activeNameSet.has(name)),
    droppedForCount,
    droppedForSchemaBudget,
    unavailableNames,
  }
}
