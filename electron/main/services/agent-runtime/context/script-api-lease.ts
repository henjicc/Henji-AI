import type {
  HenjiScriptApiProjection,
  HenjiScriptPropertyDefinition,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import type { AgentEffectKind } from '../../../../../src/core/assistant/observedEffect'

export interface HenjiScriptApiLease {
  actions: ReadonlySet<string>
  recipes: ReadonlySet<string>
  entityTypes: ReadonlySet<string>
  propertyIds: ReadonlySet<string>
  propertyDefinitions: ReadonlyMap<string, HenjiScriptPropertyDefinition>
  forbiddenEffects?: ReadonlySet<AgentEffectKind>
}

const leases = new Map<string, HenjiScriptApiLease>()

export function rememberHenjiScriptApiLease(
  runId: string,
  projection: HenjiScriptApiProjection,
): void {
  leases.set(runId, {
    actions: new Set(projection.actions.map((item) => item.id)),
    recipes: new Set(projection.recipes.map((item) => item.id)),
    entityTypes: new Set(projection.entities.entityTypes),
    propertyIds: new Set(projection.entities.propertyIds),
    propertyDefinitions: new Map(projection.entities.propertyDefinitions.map((item) => [item.id, item])),
    forbiddenEffects: new Set(projection.forbiddenEffects),
  })
}

export function getHenjiScriptApiLease(runId: string): HenjiScriptApiLease | null {
  return leases.get(runId) ?? null
}

/**
 * 续跑运行换了新 runId，租约却记在父运行名下——不接过来就等于凭空作废。
 *
 * 实测生成场景：父运行发现能力、提交生成任务后挂起等外部结果；续跑运行靠 checkpoint 把配方
 * 剩下的指令跑完了（`resume` 不查租约），但模型再想写一段新脚本就被判 SCRIPT_API_NOT_DISCOVERED。
 * 从模型的视角这句话是假的——它明明发现过能力，同一个任务、同一个对话都还在。
 *
 * 续跑在逻辑上就是同一次运行：工作摘要、对话历史、断点都继承了，租约没有理由单独掉队。
 * 父运行没有租约（比如进程重启后内存已空）时什么都不做，模型会拿到重新发现的指引。
 */
export function inheritHenjiScriptApiLease(parentRunId: string, runId: string): void {
  const parent = leases.get(parentRunId)
  if (parent) leases.set(runId, parent)
}

export function clearHenjiScriptApiLease(runId: string): void {
  leases.delete(runId)
}
