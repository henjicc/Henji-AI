import type { ApplicationExposure, ApplicationRef, ApplicationSchemaRef, JsonValue } from '../identifiers'
import type {
  ApplicationEntitySnapshot,
  ApplicationEntityTypeDescriptor,
  ApplicationCollectionAvailability,
  ApplicationPropertyAvailability,
  ApplicationPropertyDescriptor,
} from '../reflection'
import type { ApplicationDataClass } from '../identifiers'

export interface ApplicationControlAccessContext {
  signal?: AbortSignal
  exposure: ApplicationExposure
  acceptedDataClasses: ReadonlySet<ApplicationDataClass>
}

export interface ApplicationEntityListRequest {
  cursor?: string
  limit: number
  /** 只列这个父实体下的成员。只会交给声明了 listsByParent 的 provider；其余由注册表通用回退或如实拒绝。 */
  parent?: ApplicationRef
}

export interface ApplicationEntityListResult {
  refs: ApplicationRef[]
  nextCursor: string | null
  revisions: Record<string, number>
  /** 只有调用方请求了属性投影或等值过滤时才有；与过滤后的 refs 一一对应。 */
  items?: ApplicationEntityListItem[]
}

export interface ApplicationEntityListItem {
  ref: ApplicationRef
  properties: Record<string, JsonValue>
}

/**
 * 列表的声明式筛选：调用方说要哪些属性、按什么条件筛、怎么排，注册表统一读取、过滤与排序。
 *
 * list 只返回 kind/id 时模型看不见名称，“把叫 X 的那个删掉”“第 2–5 秒之间的片段”这类请求就只能
 * 整页取回逐个比对。比较方式只收真实用法的并集（等值、多值、包含、区间、时间段重叠），不做表达式语言。
 */
export interface ApplicationEntityListProjection {
  /** 要一并读回的属性；支持写全 ID，也支持只写 entityType 之后的那一段，结构化属性可再接点分路径只读回其中字段。 */
  propertyIds?: string[]
  /**
   * 过滤条件；全部命中才保留。键的写法与 propertyIds 相同，json 属性可再接点分路径筛其中的字段。
   * 值是标量时为等值；是对象时键为比较方式（见 listQuery.ts 的 WHERE_OPERATORS）。
   */
  where?: Record<string, JsonValue>
  /** 时间段重叠：实体占 [start, end) 或 [start, start+duration)，与 [from, to) 有交集即命中。 */
  overlap?: { start: string; end?: string; duration?: string; from: number; to: number }
  /** 排序键，靠前的优先；给出后先读完全部命中的实例再分页。 */
  orderBy?: Array<{ property: string; direction?: 'asc' | 'desc' }>
  /** 关键词：按名称或正文的相关度排序查找，与 where 同时给出时先排序再筛选。 */
  text?: string
}

export interface ApplicationEntityReadRequest {
  propertyIds?: string[]
}

export interface ApplicationEntityProvider {
  readonly entityType: string
  /**
   * 声明后 listEntities 必须按 request.parent 只列该父实体的直接成员（父引用不存在时抛 NOT_FOUND）。
   * 整份读回默认只展开声明了它的子实体类型；没声明的类型只在恰有一条指向父类型的引用属性时
   * 由注册表按那条属性筛，否则如实拒绝（PARENT_FILTER_UNSUPPORTED）。provider 自己遇到不支持的父类型时抛同一个前缀。
   */
  readonly listsByParent?: true
  listEntities(request: ApplicationEntityListRequest): Promise<ApplicationEntityListResult>
  readEntity(
    ref: ApplicationRef,
    request: ApplicationEntityReadRequest,
    /** Trusted registry access, for projections containing facts from more than one domain. */
    context?: ApplicationControlAccessContext
  ): Promise<ApplicationEntitySnapshot>
  getPropertyAvailability(
    ref: ApplicationRef,
    propertyIds: string[]
  ): Promise<ApplicationPropertyAvailability[]>
  getCollectionAvailability(parent: ApplicationRef): Promise<ApplicationCollectionAvailability>
}

export interface ApplicationSchemaDocument {
  ref: ApplicationSchemaRef
  value: JsonValue
  /** 运行期保留领域校验及中文提示；不参与传输或持久化。 */
  validator?: import('zod').z.ZodType
}

export interface ApplicationEntityRegistration {
  entity: ApplicationEntityTypeDescriptor
  properties: ApplicationPropertyDescriptor[]
  provider?: ApplicationEntityProvider
  schemaDocuments?: ApplicationSchemaDocument[]
}

export interface ApplicationRegistryQuery {
  domains?: string[]
  entityTypes?: string[]
  propertyIds?: string[]
  /** 按文字找属性：在属性 ID、标题与说明里按相关度检索，只返回命中的属性及其所属实体。 */
  text?: string
  includeUnavailable?: boolean
}

export interface ApplicationRegistryDescription {
  catalogVersion: string
  entities: ApplicationEntityTypeDescriptor[]
  properties: ApplicationPropertyDescriptor[]
}
