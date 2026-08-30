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
  const describedEntities = records(description.entities)
  const describedEntityTypeSet = new Set(describedEntities.flatMap((item) => (
    typeof item.id === 'string' ? [item.id] : []
  )))
  /*
   * impacts / acceptsRefs / producesRefs 里的类型还包含 Surface、schema、批次计划等协议对象；
   * 它们能参与 action 排序和参数传递，但不是 app.entities 可读写的业务实体。最终租约必须以
   * 反射 describe 的真相收口，否则模型会照着不存在的类型调用 read，必然撞
   * ENTITY_TYPE_NOT_FOUND。真实业务引用漏注册（如 image_edit.preview）应补反射，而不是留在这里。
   */
  const entityTypes = output.scriptApi.entities.entityTypes.filter((entityType) => (
    describedEntityTypeSet.has(entityType)
  ))
  const entityTypeSet = new Set(entityTypes)
  const entityDefinitions = describedEntities.flatMap((item) => {
    if (typeof item.id !== 'string' || !entityTypeSet.has(item.id)) return []
    const parsed = henjiScriptEntityDefinitionSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  }).slice(0, 64)

  /*
   * 进了投影的实体，它的属性要**全给**，不能只给能力 impacts 点过名的那几条。
   *
   * 这里曾经拿 `scriptApi.entities.propertyIds` 当过滤器：只有被某条能力的 impacts 声明过的
   * 属性才会带上定义。可 impacts 是按"这个操作影响什么"写的，天然不完整——素材库能力声明了
   * `asset.tags`，却没声明 `asset.library.name`，于是模型拿到的投影里**根本没有名称字段**。
   * 实测它试了几次之后停下来问用户"素材库的名称应该写在哪个属性上"——它不是不会做，是被
   * 投影告知这个字段不存在。
   *
   * 准入仍然是注册表真相：实体类型必须在本轮投影里。impacts 声明退化成排序提示（声明过的排
   * 前面），不再决定有无。这跟 structuralMatch 那条规则是同一句话——软信号不得当硬过滤。
   */
  const declaredProperties = new Set(output.scriptApi.entities.propertyIds)
  const propertyDefinitions = records(description.properties).flatMap((item) => {
    if (typeof item.id !== 'string' || typeof item.entityType !== 'string') return []
    if (!entityTypeSet.has(item.entityType)) return []
    const parsed = henjiScriptPropertyDefinitionSchema.safeParse(item)
    return parsed.success ? [parsed.data] : []
  }).sort((left, right) => (
    Number(declaredProperties.has(right.id)) - Number(declaredProperties.has(left.id))
  )).slice(0, 256)

  const propertyIds = propertyDefinitions.map((item) => item.id)

  return applicationCapabilityDiscoveryOutputSchema.parse({
    ...output,
    scriptApi: {
      ...output.scriptApi,
      entities: {
        ...output.scriptApi.entities,
        entityTypes,
        propertyIds,
        entityDefinitions,
        propertyDefinitions,
      },
    },
  })
}
