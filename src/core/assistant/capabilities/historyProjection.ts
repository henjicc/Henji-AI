/**
 * 结果进入对话历史前的字段投影。
 *
 * 用**排除法**而不是白名单：目录与反射类结果的元素 schema 是 `z.record(string, unknown)`，
 * 白名单会在领域侧新增语义字段时把它们静默丢掉——模型看不到新字段，却没有任何地方报错。
 * 排除法只删这里明确点名、且能说出理由的字段，新增字段默认仍然到得了模型手上。
 */
export function omitRecordKeys<T>(items: readonly T[], keys: readonly string[]): unknown[] {
  const removed = new Set<string>(keys)
  return items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).filter(([key]) => !removed.has(key))
    )
  })
}

/**
 * 属性与实体反射结果里对模型不可行动的字段。
 *
 * - `schemaRef`：`id` / `version` 只是把元素自身的字段又抄了一遍，`catalogVersion` 是常量，
 *   只有 `digest` 是新信息，而模型对属性 digest 没有任何用法。实测占 properties 体积的 44%。
 * - `requiredPermissions` / `exposures` / `revisionScopes` / `dataClass`：全部由网关和乐观并发
 *   信封强制执行，模型既不能绕过也不能据此改变做法，读到只会占位置。
 *
 * 保留 `description`：它是模型在上百条属性里挑对那一条的语义线索，删了会换来猜属性名。
 */
export const APPLICATION_REFLECTION_HISTORY_OMITTED_KEYS = [
  'schemaRef',
  'requiredPermissions',
  'exposures',
  'revisionScopes',
  'dataClass',
] as const

/**
 * 能力发现结果里与本轮 `tools` 参数重复或只服务运行时匹配的字段。
 *
 * - `schemaRef`：活动工具每轮都带完整输入 schema（system prompt 亦如此声明），这里是重复。
 * - `capabilityId` / `category`：实测与 `name` / `domain` 逐字符相同。
 * - `entityTypes` / `propertyIds`：运行时用它们做 Facet 与 Effect 匹配，模型选能力看的是
 *   `title` 与 `description`；属性清单该走 `describe_application_entities`。
 */
export const CAPABILITY_DISCOVERY_HISTORY_OMITTED_KEYS = [
  'schemaRef',
  'capabilityId',
  'category',
  'entityTypes',
  'propertyIds',
] as const
