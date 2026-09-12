import { externalWritable, type LocalDomainSurface, type LocalEntitySurface } from '@/core/application-control/localHostContracts'
import type { ApplicationReflectionRegistry } from '@/core/application-control'
import { getApplicationReflectionRegistry } from '@/features/assistant/applicationCapabilities/applicationControlRegistry'

/**
 * 外部能力面的唯一派生处。
 *
 * **为什么必须派生而不是写一张表**：主进程原先用 `entityType` 前缀白名单判断"这个实体属不属于
 * 公开写入范围"（`operationCoordinator.writableDomain`）。那张表与领域声明是两份真相，新增一个
 * 业务写域就要记得回去改它——这正是本项目反复吃亏的形状（见 applicationReflection 里
 * `mutationScope` 的两轮漂移）。现在它由注册表的 `exposures`、`requiredPermissions.write`、
 * `collectionWrite` 与 `writeExclusion` 直接派生：领域注册了属性就自动可写，声明了排除原因就
 * 自动变成带理由的只读，MCP 侧一行都不用改。
 *
 * 只投影结构，不投影任何属性值，所以调用方拿到的是"有哪些域、哪些实体、能不能写"，不是一份
 * 几十 KB 的全属性目录；属性细节仍然由 `describe_application_entities` 按域按需取。
 */
export function buildExternalCapabilityInventory(registry: ApplicationReflectionRegistry = getApplicationReflectionRegistry()): LocalDomainSurface[] {
  // 外部调用方一律走 local_adapter 暴露面；助手运行、记忆与诊断在注册阶段已被剥离该暴露。
  const description = registry.describe({}, {
    exposure: 'local_adapter',
    permissions: new Set(['application:read', 'application:write', ...registry.listDeclaredPropertyPermissions()]),
    acceptedDataClasses: new Set(['C0', 'C1'] as const),
  })
  const writablePropertyCounts = new Map<string, number>()
  for (const property of description.properties) {
    if (property.requiredPermissions.write.length === 0) continue
    writablePropertyCounts.set(property.entityType, (writablePropertyCounts.get(property.entityType) ?? 0) + 1)
  }
  const domains = new Map<string, LocalEntitySurface[]>()
  for (const entity of description.entities) {
    const excluded = entity.writeExclusion?.reason
    const surface: LocalEntitySurface = {
      id: entity.id,
      title: entity.title,
      writableProperties: excluded ? 0 : writablePropertyCounts.get(entity.id) ?? 0,
      creatable: !excluded && entity.collectionWrite?.creatable === true,
      removable: !excluded && entity.collectionWrite?.removable === true,
      ...(excluded ? { readOnlyReason: excluded } : {}),
    }
    const list = domains.get(entity.domain) ?? []
    list.push(surface)
    domains.set(entity.domain, list)
  }
  return [...domains.entries()]
    .map(([id, entities]): LocalDomainSurface => ({
      id,
      readable: entities.length > 0,
      writable: entities.some(externalWritable),
      entities: entities.sort((left, right) => left.id.localeCompare(right.id)).slice(0, 128),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}
