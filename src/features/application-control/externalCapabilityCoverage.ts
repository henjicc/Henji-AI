import type { ApplicationCapabilityDefinition } from '@/core/application-control/applicationCapabilities'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '@/core/application-control/builtinApplicationCapabilityRegistry'
import { isExternalApplicationTool, projectExternalCapabilities } from '@/core/application-control/externalCapabilityPolicy'
import type { ApplicationReflectionRegistry } from '@/core/application-control'
import { listRendererApplicationCapabilityIds } from '@/features/application-control/capabilities/registry'
import { getApplicationReflectionRegistry } from '@/features/application-control/capabilities/applicationControlRegistry'

/** 从软件能力全集向外核对，不能从已经成功发布的 MCP 子集反推“无遗漏”。 */
export function auditExternalCapabilityCoverage(input: {
  definitions?: readonly ApplicationCapabilityDefinition[]
  handlerIds?: readonly string[]
  publishedIds?: readonly string[]
  reflection?: ApplicationReflectionRegistry
} = {}) {
  const definitions = input.definitions ?? BUILTIN_APPLICATION_CAPABILITY_REGISTRY.list()
  const handlers = new Set(input.handlerIds ?? listRendererApplicationCapabilityIds())
  const published = new Set(input.publishedIds ?? projectExternalCapabilities(definitions).all.map(definition => definition.id))
  const reflection = input.reflection ?? getApplicationReflectionRegistry()
  const description = reflection.describe({}, { exposure: 'local_adapter',
    permissions: new Set(reflection.listDeclaredPropertyPermissions()), acceptedDataClasses: new Set(['C0', 'C1']) })
  const entities = new Map(description.entities.map(entity => [entity.id, entity]))
  const properties = new Map(description.properties.map(property => [property.id, property]))
  const issues: string[] = []
  const rows = definitions.map(definition => {
    const external = definition.external
    if (definition.side === 'backend') return { id: definition.id, route: 'internal' as const }
    if (external?.kind === 'internal') return { id: definition.id, route: 'internal' as const, reason: external.reason }
    if (external?.kind === 'delegate') {
      const entity = entities.get(external.entityType)
      if (!entity) issues.push(`${definition.id}: 通用入口实体 ${external.entityType} 未对 MCP 开放`)
      for (const operation of external.operations) {
        if (operation === 'read' && !published.has('read_application_entity')) issues.push(`${definition.id}: 通用读取工具缺失`)
        if (operation !== 'read' && !published.has('change_application_entities')) issues.push(`${definition.id}: 通用写入工具缺失`)
        if (operation === 'create' && !entity?.collectionWrite?.creatable) issues.push(`${definition.id}: ${external.entityType} 不可创建`)
        if (operation === 'remove' && !entity?.collectionWrite?.removable) issues.push(`${definition.id}: ${external.entityType} 不可删除`)
        if (operation === 'write' && (entity?.writeExclusion || !description.properties.some(property => property.entityType === external.entityType
          && !property.readOnlyReason && property.requiredPermissions.write.length))) issues.push(`${definition.id}: ${external.entityType} 没有可写属性`)
      }
      for (const id of external.propertyIds ?? []) {
        const property = properties.get(id)
        if (!property || property.entityType !== external.entityType || property.readOnlyReason || !property.requiredPermissions.write.length)
          issues.push(`${definition.id}: 委托属性 ${id} 实际不可写`)
      }
      return { id: definition.id, route: 'delegate' as const, entityType: external.entityType }
    }
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
