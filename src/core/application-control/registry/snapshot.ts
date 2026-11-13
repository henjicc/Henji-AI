import type { ApplicationRef, JsonValue } from '../identifiers'
import type { ApplicationEntityTypeDescriptor, ApplicationPropertyDescriptor } from '../reflection'
import { describeJsonValueShape } from './jsonValueShape'
import type { ApplicationReflectionRegistry } from './registry'
import type { ApplicationControlAccessContext } from './types'

/**
 * 整份读回：从一个根实体出发，沿登记的父子关系向下展开，一次返回一棵带属性值的树。
 *
 * 读取只走注册表的 listChildren 与 readEntity，和逐个 list、read 是同一条路，没有第二份业务读取。
 * 为了让一条几十上百个成员的时间线读得起，同类实体里取值全相同的属性只在 types 里写一次（shared），
 * 节点只留各自不同的值；空值不写。读法只有一条：节点属性 > 该类型的 shared > 都没有就是空。
 */
export interface ApplicationSnapshotRequest {
  root: ApplicationRef
  /** 向下展开的层数；省略展开到底，0 只读根实体。 */
  depth?: number
  /** 只展开这些子实体类型（通往它们的中间层照常展开）；省略时展开默认的子类型。 */
  entityTypes?: string[]
  /** 按实体类型点名属性（短键或完整属性 ID）；点名的类型只返回点名的属性，原样不省略。 */
  properties?: Record<string, string[]>
  /** 这次最多返回多少个实体；超出的成员在所属节点的 more 里给出续读参数。 */
  limit: number
  /** 续读：取自上一次返回的 more，形如“类型@已读个数”。只接着读根实体下这一类成员，它们的子层照常展开。 */
  cursor?: string
}

export interface ApplicationSnapshotNode {
  ref: { kind: string; id: string }
  properties?: Record<string, JsonValue>
  /** 体积过大没有展开的属性及其字符数，用 read_application_entity 点名读取。 */
  large?: Record<string, number>
  children?: Record<string, ApplicationSnapshotNode[]>
  /** 还没读完的成员：把其中一项并进原参数再调用一次（其余参数保持不变）。depth 是从这个节点起还剩的层数。 */
  more?: Array<{ root: { kind: string; id: string }; cursor: string; depth?: number }>
  /** 这个实体本身没读到的原因（列出之后被删、读取出错）；没有属性与子层。 */
  error?: string
  /** 没能列出的子实体类型及原因。 */
  failed?: Record<string, string>
}

export interface ApplicationSnapshotTypeInfo {
  title: string
  description?: string
  /** 能在哪些父实体下新建，以及新建时必须给的属性（键 → 取值说明）。 */
  create?: { under: string[]; required: Record<string, string> }
  removable?: true
  readOnly?: string
  /** 这次返回里出现的属性：键 → “标题｜取值｜只读”。写入时键可直接用。 */
  properties?: Record<string, string>
  /** 这次返回的该类实体都相同的值；节点里不再重复。 */
  shared?: Record<string, JsonValue>
  /** 当前为空的属性键。 */
  unset?: string[]
  /** 默认不随整份读回返回的属性键（界面状态或体积大），用 properties 点名才返回。 */
  onRequest?: string[]
}

export interface ApplicationSnapshotResult {
  root: ApplicationSnapshotNode
  types: Record<string, ApplicationSnapshotTypeInfo>
  entityCount: number
  /** 存在但这次没有展开的子实体类型；用 entityTypes 点名展开。 */
  notExpanded?: string[]
  /** 因 limit 没读完时的说明。 */
  incomplete?: string
  /** 全部节点的引用，供调用方登记稳定引用；不交给模型。 */
  refs: ApplicationRef[]
}

/** 单个属性值超过这个字符数就只报体积：一份快照里有很多节点，转录稿、源码、关键帧数组这类值逐个展开会淹没结构。 */
const LARGE_VALUE_CHARS = 2000
const TYPE_TEXT_LIMIT = 120
const REASON_LIMIT = 300

function isEmpty(value: JsonValue | undefined): boolean {
  return value === undefined || value === null || value === ''
    || (Array.isArray(value) && value.length === 0)
    || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)
}

function rangeText(min: unknown, max: unknown): string {
  const low = typeof min === 'number' && Math.abs(min) < Number.MAX_SAFE_INTEGER ? min : undefined
  const high = typeof max === 'number' && Math.abs(max) < Number.MAX_SAFE_INTEGER ? max : undefined
  if (low === undefined && high === undefined) return ''
  return low !== undefined && high !== undefined ? ` ${low}–${high}` : low !== undefined ? ` ≥${low}` : ` ≤${high}`
}

/** 取值说明：类型、范围与枚举值。比结构描述短得多，够填对一个值；要完整 schema 再用 describe_application_entities 点名。 */
function valueText(property: ApplicationPropertyDescriptor, schema: JsonValue | undefined): string {
  const value = property.value
  let text: string
  switch (value.kind) {
    case 'number': case 'integer': text = `${value.kind}${rangeText(value.hardRange?.min, value.hardRange?.max)}`; break
    case 'enum': text = value.values.map((item) => JSON.stringify(item.value)).join(' | '); break
    case 'color': text = `color(${value.format})`; break
    case 'vector2': text = '{x, y}'; break
    case 'vector3': text = '{x, y, z}'; break
    case 'ref': text = `ref<${value.refKinds.join(' | ')}>`; break
    case 'ref_list': text = `ref<${value.refKinds.join(' | ')}>[]`; break
    case 'json': {
      const node = schema && typeof schema === 'object' && !Array.isArray(schema) ? schema : {}
      text = Array.isArray(node.enum) ? node.enum.map((item) => JSON.stringify(item)).join(' | ')
        : node.type === 'number' || node.type === 'integer' ? `${node.type}${rangeText(node.minimum, node.maximum)}`
          : describeJsonValueShape(schema)
      break
    }
    default: text = value.kind
  }
  if (text.length > TYPE_TEXT_LIMIT) text = `${text.slice(0, TYPE_TEXT_LIMIT)}…`
  if (property.nullable && !/\bnull\b/.test(text)) text += ' | null'
  return property.unit ? `${text} ${property.unit}` : text
}

function isWritable(property: ApplicationPropertyDescriptor): boolean {
  return property.requiredPermissions.write.length > 0 && !property.readOnlyReason
}

export async function readApplicationSnapshot(
  registry: ApplicationReflectionRegistry,
  request: ApplicationSnapshotRequest,
  context: ApplicationControlAccessContext,
): Promise<ApplicationSnapshotResult> {
  const shortKey = (entityType: string, propertyId: string): string => propertyId.startsWith(`${entityType}.`) ? propertyId.slice(entityType.length + 1) : propertyId
  // 类型写错时由注册表给出同域已登记的类型
  const requireType = (entityType: string): ApplicationEntityTypeDescriptor => registry.visibleEntity(entityType, context)
  requireType(request.root.kind)
  const selected = request.entityTypes?.length ? new Set(request.entityTypes.map((entityType) => requireType(entityType).id)) : undefined
  const named = new Map(Object.entries(request.properties ?? {}).map(([entityType, keys]) => (
    [requireType(entityType).id, keys.map((key) => registry.resolvePropertyId(entityType, key))] as const
  )))
  const leadsToSelected = (entityType: string, seen = new Set<string>()): boolean => {
    if (selected!.has(entityType)) return true
    if (seen.has(entityType)) return false
    seen.add(entityType)
    return registry.childEntityTypes(entityType, context).some((child) => leadsToSelected(child.id, seen))
  }
  const notExpanded = new Set<string>()
  const expandableByType = new Map<string, ApplicationEntityTypeDescriptor[]>()
  const expandable = (parentType: string): ApplicationEntityTypeDescriptor[] => {
    if (!expandableByType.has(parentType)) {
      expandableByType.set(parentType, registry.childEntityTypes(parentType, context).filter((child) => {
        const expand = selected ? leadsToSelected(child.id) : Boolean(registry.getProvider(child.id)?.listsByParent) && !child.omitFromDefaultSnapshot
        if (!expand) notExpanded.add(child.id)
        return expand
      }))
    }
    return expandableByType.get(parentType)!
  }
  // 续读只接着读根实体下 more 指的那一类：根下其余类型上一次已经读过，不再展开；这一类成员的子层与首次一样展开
  let resume: { type: ApplicationEntityTypeDescriptor; skip: number } | undefined
  if (request.cursor !== undefined) {
    const match = /^(.+)@(\d+)$/.exec(request.cursor)
    const type = match ? registry.getEntity(match[1]) : undefined
    const skip = Number(match?.[2])
    if (!type || !Number.isSafeInteger(skip) || !type.parentTypes.includes(request.root.kind)) {
      throw new Error('INVALID_CURSOR：cursor 只用于续读：把上一次返回的某个节点 more 里的 root、cursor（以及 depth）原样并进原参数。')
    }
    resume = { type: requireType(type.id), skip }
  }
  const childTypesOf = (parentType: string, isRoot: boolean): ApplicationEntityTypeDescriptor[] => isRoot && resume ? [resume.type] : expandable(parentType)
  // 展开范围内的类型即使这次没有实例，也要告诉调用方怎么新建
  const scopedTypes = new Set<string>()
  for (let depth = 0, types = [request.root.kind]; types.length && (request.depth === undefined || depth < request.depth); depth += 1) {
    const next: string[] = []
    for (const parentType of types) for (const child of childTypesOf(parentType, depth === 0)) {
      if (scopedTypes.has(child.id)) continue
      scopedTypes.add(child.id); next.push(child.id)
    }
    types = next
  }

  // 只看调用方读得到的属性：读不到的既不读，也不在 types 里报出键名
  const readableByType = new Map<string, ApplicationPropertyDescriptor[]>()
  const readable = (entityType: string): ApplicationPropertyDescriptor[] => {
    if (!readableByType.has(entityType)) readableByType.set(entityType, registry.describe({ entityTypes: [entityType] }, context).properties)
    return readableByType.get(entityType)!
  }
  const propertyIdsOf = (entityType: string): string[] => named.get(entityType)
    ?? readable(entityType).filter((property) => !property.omitFromDefaultRead && !property.viewState).map((property) => property.id)
  const nodesByType = new Map<string, ApplicationSnapshotNode[]>()
  const refs: ApplicationRef[] = []
  const readNode = async (ref: ApplicationRef): Promise<ApplicationSnapshotNode> => {
    const snapshot = await registry.readEntity(ref, propertyIdsOf(ref.kind), context)
    const node: ApplicationSnapshotNode = { ref: { kind: snapshot.ref.kind, id: snapshot.ref.id } }
    const properties: Record<string, JsonValue> = {}
    for (const [propertyId, value] of Object.entries(snapshot.properties)) {
      const key = shortKey(ref.kind, propertyId)
      if (named.has(ref.kind)) { properties[key] = value; continue }
      if (isEmpty(value)) continue
      const chars = JSON.stringify(value).length
      if (chars > LARGE_VALUE_CHARS) (node.large ??= {})[key] = chars
      else properties[key] = value
    }
    if (Object.keys(properties).length) node.properties = properties
    if (!nodesByType.has(ref.kind)) nodesByType.set(ref.kind, [])
    nodesByType.get(ref.kind)!.push(node)
    refs.push(snapshot.ref)
    return node
  }

  // 根实体读不到是调用方给错了目标，整体失败；它之下的单个成员或某一类成员读不到，只在所在节点上标出原因，其余照常返回
  const reason = (error: unknown): string => {
    if (context.signal?.aborted) throw error
    return (error instanceof Error ? error.message : String(error)).slice(0, REASON_LIMIT)
  }
  const root = await readNode(request.root)
  let count = 1
  let level: ApplicationSnapshotNode[] = [root]
  let truncated = false
  for (let depth = 0; level.length && (request.depth === undefined || depth < request.depth); depth += 1) {
    const groups: Array<{ parent: ApplicationSnapshotNode; type: string; refs: ApplicationRef[]; skipped: number }> = []
    for (const parent of level) {
      for (const child of childTypesOf(parent.ref.kind, parent === root)) {
        let listed: ApplicationRef[]
        try { listed = (await registry.listChildren(child.id, parent.ref, context)).refs } catch (error) {
          // 这一类没法按父实体列出：记下来让调用方知道它没被展开
          if (error instanceof Error && error.message.startsWith('PARENT_FILTER_UNSUPPORTED')) notExpanded.add(child.id)
          else (parent.failed ??= {})[child.id] = reason(error)
          continue
        }
        const skipped = parent === root && resume ? resume.skip : 0
        if (listed.length > skipped) groups.push({ parent, type: child.id, refs: listed.slice(skipped), skipped })
      }
    }
    // 小的集合先读全：轨道、标记这类几项的成员不该被几百个片段挤掉
    const order = [...groups].sort((left, right) => left.refs.length - right.refs.length)
    const next: ApplicationSnapshotNode[] = []
    const read = new Map<typeof groups[number], ApplicationSnapshotNode[]>()
    for (const group of order) {
      // 续读的那一类至少读一个：额度再小游标也要前进，否则照着 more 续读会原地打转
      const least = resume && group.parent === root ? 1 : 0
      const take = Math.max(least, Math.min(group.refs.length, request.limit - count))
      const nodes: ApplicationSnapshotNode[] = []
      for (const ref of group.refs.slice(0, take)) {
        try { nodes.push(await readNode(ref)) } catch (error) { nodes.push({ ref: { kind: ref.kind, id: ref.id }, error: reason(error) }) }
      }
      count += take
      read.set(group, nodes)
      if (take < group.refs.length) {
        truncated = true
        ;(group.parent.more ??= []).push({ root: group.parent.ref, cursor: `${group.type}@${group.skipped + take}`,
          ...(request.depth !== undefined ? { depth: request.depth - depth } : {}) })
      }
    }
    // 输出按登记顺序排列，与读取的先后无关
    for (const group of groups) {
      const nodes = read.get(group)!
      if (!nodes.length) continue
      ;(group.parent.children ??= {})[group.type] = nodes
      next.push(...nodes.filter((node) => node.error === undefined))
    }
    level = next
  }

  const sharedByType = new Map<string, Record<string, JsonValue>>()
  for (const [entityType, nodes] of nodesByType) {
    if (named.has(entityType) || nodes.length < 2) continue
    const shared: Record<string, JsonValue> = {}
    for (const [key, value] of Object.entries(nodes[0].properties ?? {})) {
      const text = JSON.stringify(value)
      if (nodes.every((node) => node.properties && key in node.properties && JSON.stringify(node.properties[key]) === text)) shared[key] = value
    }
    if (!Object.keys(shared).length) continue
    sharedByType.set(entityType, shared)
    for (const node of nodes) {
      for (const key of Object.keys(shared)) delete node.properties![key]
      if (!Object.keys(node.properties!).length) delete node.properties
    }
  }

  const types: Record<string, ApplicationSnapshotTypeInfo> = {}
  const propertyText = (property: ApplicationPropertyDescriptor): string => {
    const schema = property.value.kind === 'json' ? registry.resolveSchema(property.value.schemaRef, context) : undefined
    return valueText(property, schema)
  }
  for (const entityType of new Set([...nodesByType.keys(), ...scopedTypes])) {
    const entity = registry.getEntity(entityType)!
    const nodes = nodesByType.get(entityType)
    const all = readable(entityType)
    const byId = new Map(all.map((property) => [property.id, property]))
    const creatable = entity.collectionWrite?.creatable
    // 这次没有实例的类型只在能新建时才有话可说
    if (!nodes && !creatable) continue
    const info: ApplicationSnapshotTypeInfo = { title: entity.title }
    if (registry.hasOwnDescription(entityType)) info.description = entity.description
    if (creatable) {
      info.create = { under: entity.parentTypes, required: Object.fromEntries(entity.collectionWrite!.requiredPropertyIds.map((propertyId) => (
        [shortKey(entityType, propertyId), byId.has(propertyId) ? propertyText(byId.get(propertyId)!) : 'JSON']
      ))) }
    }
    if (entity.collectionWrite?.removable) info.removable = true
    if (entity.writeExclusion) info.readOnly = entity.writeExclusion.reason
    if (nodes) {
      const shared = sharedByType.get(entityType)
      const present = new Set<string>(Object.keys(shared ?? {}))
      for (const node of nodes) for (const key of [...Object.keys(node.properties ?? {}), ...Object.keys(node.large ?? {})]) present.add(key)
      const requested = new Set(propertyIdsOf(entityType))
      const properties: Record<string, string> = {}
      const unset: string[] = []
      const onRequest: string[] = []
      for (const property of all) {
        const key = shortKey(entityType, property.id)
        if (present.has(key)) properties[key] = `${property.title}｜${propertyText(property)}${isWritable(property) ? '' : '｜只读'}`
        else if (requested.has(property.id)) unset.push(key)
        else if (!named.has(entityType)) onRequest.push(key)
      }
      if (Object.keys(properties).length) info.properties = properties
      if (shared) info.shared = shared
      if (unset.length) info.unset = unset
      if (onRequest.length) info.onRequest = onRequest
    }
    types[entityType] = info
  }

  return {
    root, types, entityCount: count, refs,
    ...(notExpanded.size ? { notExpanded: [...notExpanded] } : {}),
    ...(truncated ? { incomplete: `只返回了前 ${count} 个实体。带 more 的节点还有成员没读：把 more 里的一项并进原参数再调用一次，或调大 limit。` } : {}),
  }
}
