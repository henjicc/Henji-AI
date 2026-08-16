import {
  applicationCapabilityDiscoveryOutputSchema,
  henjiScriptEntityDefinitionSchema,
  henjiScriptPropertyDefinitionSchema,
  type ApplicationCapabilityDiscoveryOutput,
} from '../../../../../src/core/assistant/capabilityDiscovery'

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      ))
    : []
}

/**
 * 把渲染层反射注册表的真实值约束并入脚本租约。
 *
 * 能力目录只知道某个操作“影响了哪些属性”，不知道 enum、数值范围或 ref 形状；这些真相只在
 * Application Reflection Registry。若发现阶段不把两者合并，模型只能猜值，脚本也无法在首次
 * 写入前做静态校验。这里是两份注册信息唯一的合流点，不在具体领域复制枚举。
 */
export function hydrateHenjiScriptApi(
  output: ApplicationCapabilityDiscoveryOutput,
  description: Record<string, unknown>,
): ApplicationCapabilityDiscoveryOutput {
  const entityTypeSet = new Set(output.scriptApi.entities.entityTypes)
  const entityDefinitions = records(description.entities).flatMap((item) => {
    if (typeof item.id !== 'string' || !entityTypeSet.has(item.id)) return []
    const parsed = henjiScriptEntityDefinitionSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  }).slice(0, 64)

  const explicitlyLeasedProperties = new Set(output.scriptApi.entities.propertyIds)
  const propertyDefinitions = records(description.properties).flatMap((item) => {
    if (typeof item.id !== 'string' || typeof item.entityType !== 'string') return []
    if (!entityTypeSet.has(item.entityType)) return []
    if (explicitlyLeasedProperties.size > 0 && !explicitlyLeasedProperties.has(item.id)) return []
    const parsed = henjiScriptPropertyDefinitionSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  }).slice(0, 256)

  const propertyIds = explicitlyLeasedProperties.size > 0
    ? output.scriptApi.entities.propertyIds
    : propertyDefinitions.map((item) => item.id)

  return applicationCapabilityDiscoveryOutputSchema.parse({
    ...output,
    scriptApi: {
      ...output.scriptApi,
      entities: {
        ...output.scriptApi.entities,
        propertyIds,
        entityDefinitions,
        propertyDefinitions,
      },
    },
  })
}
