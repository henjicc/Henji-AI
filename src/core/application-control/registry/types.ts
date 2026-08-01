import type { ApplicationExposure, ApplicationRef, ApplicationSchemaRef, JsonValue } from '../identifiers'
import type {
  ApplicationEntitySnapshot,
  ApplicationEntityTypeDescriptor,
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
