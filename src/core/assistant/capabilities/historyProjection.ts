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
 * 剥掉 scriptApi 投影里**可证明重复**的部分，一个字节的新信息都不删。
 *
 * 实测 camera 场景那份 66KB 的发现结果里，`entities.propertyIds` 占 6.1KB，与
 * `propertyDefinitions[].id` **逐字相同**（已断言 true）。剥掉它 66KB 降到约 60KB，
 * 落进内联下限，模型不必再用 3 个回合把它逐页读回来。
 *
 * **只剥这一项。** `propertyDefinitions[].entityType` 同样可以从 id 前缀推导（实测 139/139
 * 条都是），一度也被剥掉，但真机验证里模型随即在"哪个属性属于哪个实体"上连错两次：
 * 关键帧实体类型少写了一截前缀，又把工程级的 id 当成关键帧自己的属性。
 * 可推导不等于同样好用——要模型去解析字符串前缀才能还原的关联，就不是重复。何况少了这
 * 6.1KB 已经足够内联，那 4.8KB 是拿正确率换的，不划算。
 *
 * **不碰 `description`**：那是模型在上百条属性里挑对那一条的语义线索，见下面那条注释。
 */
export function trimScriptApiDuplication(scriptApi: unknown): unknown {
  if (!scriptApi || typeof scriptApi !== 'object' || Array.isArray(scriptApi)) return scriptApi
  const record = scriptApi as Record<string, unknown>
  const entities = record.entities
  if (!entities || typeof entities !== 'object' || Array.isArray(entities)) return scriptApi
  const entityRecord = entities as Record<string, unknown>
  const { propertyIds: _identicalToDefinitionIds, ...restEntities } = entityRecord
  return { ...record, entities: restEntities }
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
