import type { ApplicationCapabilityDefinition } from '@/core/application-control/applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { isExternalApplicationTool, projectExternalCapabilities } from '@/core/application-control/externalCapabilityPolicy'
import { listRendererApplicationCapabilityIds } from '@/features/application-control/capabilities/registry'

/** 从软件能力全集向外核对，不能从已经成功发布的 MCP 子集反推“无遗漏”。 */
export function auditExternalCapabilityCoverage(input: {
  definitions?: readonly ApplicationCapabilityDefinition[]
  handlerIds?: readonly string[]
  publishedIds?: readonly string[]
} = {}) {
  const definitions = input.definitions ?? BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()
  const handlers = new Set(input.handlerIds ?? listRendererApplicationCapabilityIds())
  const published = new Set(input.publishedIds ?? projectExternalCapabilities(definitions).all.map(definition => definition.id))
  const issues: string[] = []
  const rows = definitions.map(definition => {
    const external = definition.external
    if (definition.side === 'backend') return { id: definition.id, route: 'internal' as const }
    if (!isExternalApplicationTool(definition) && external?.kind !== 'recovery') issues.push(`${definition.id}: 缺少明确开放路径或排除原因`)
    if (!handlers.has(definition.id)) issues.push(`${definition.id}: 没有正式应用执行器`)
    if (!published.has(definition.id)) issues.push(`${definition.id}: 没有进入宿主/MCP 目录`)
    if (!definition.readOnly && external?.kind !== 'recovery' && definition.id !== 'change_application_entities' && !definition.resolveOperationTargets)
      issues.push(`${definition.id}: 写操作未绑定实际目标`)
    if (definition.paidGenerationPreparation && !published.has(definition.paidGenerationPreparation))
      issues.push(`${definition.id}: 付费准备入口 ${definition.paidGenerationPreparation} 不可调用`)
    return { id: definition.id, route: external?.kind === 'recovery' ? 'recovery' as const : 'tool' as const }
  })
  return { rows, issues }
}
