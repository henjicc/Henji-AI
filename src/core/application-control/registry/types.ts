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
  exposure: ApplicationExposure
  permissions: ReadonlySet<string>
  acceptedDataClasses: ReadonlySet<ApplicationDataClass>
}

export interface ApplicationEntityListRequest {
  cursor?: string
  limit: number
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
 * 「按名字找到那一个」——用户天天这么说，以前脚本里写不出来。
 *
 * list 只返回 kind/id，模型看不见名称；受限脚本语言又不允许遍历读取结果去逐个比对（那是
 * 编译期展开的硬约束，不能为此放宽）。两条合起来，"确认改名成功了""把叫 X 的那个删掉"
 * 这类最普通的请求就成了死路。实测四个场景全都撞过：素材库场景直接被打挂。
 *
 * 出路不是放宽语言，而是把筛选下沉成**声明式的后端能力**：调用方说要哪些属性、按什么等值
 * 条件筛，注册表统一读取并过滤。等值是有意的下限——它覆盖了实测的全部真实用法，又不会把
 * 通用查询语言的复杂度引进来。
 */
export interface ApplicationEntityListProjection {
  /** 要一并读回的属性；支持写全 ID，也支持只写 entityType 之后的那一段。 */
  propertyIds?: string[]
  /** 等值过滤条件；全部命中才保留。键的写法与 propertyIds 相同。 */
  where?: Record<string, JsonValue>
}

export interface ApplicationEntityReadRequest {
  propertyIds?: string[]
}

export interface ApplicationEntityProvider {
  readonly entityType: string
  listEntities(request: ApplicationEntityListRequest): Promise<ApplicationEntityListResult>
  readEntity(
    ref: ApplicationRef,
    request: ApplicationEntityReadRequest
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
  includeUnavailable?: boolean
}

export interface ApplicationRegistryDescription {
  catalogVersion: string
  entities: ApplicationEntityTypeDescriptor[]
  properties: ApplicationPropertyDescriptor[]
}
