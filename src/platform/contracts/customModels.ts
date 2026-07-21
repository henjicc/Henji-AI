export interface CustomModelPlatformRecord {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: DynamicValueMap
  isEnabled: boolean
  createdAt: string
  updatedAt: string
}

export interface InsertCustomModelPlatformPayload {
  id: string
  name: string
  providerId: string
  baseModel: string | null
  config: DynamicValueMap
  isEnabled: boolean
}

export interface UpdateCustomModelPlatformPayload {
  name?: string
  config?: DynamicValueMap
  isEnabled?: boolean
}

export interface CustomModelsPlatform {
  insertModel(model: InsertCustomModelPlatformPayload): Promise<void>
  listModels(providerId?: string): Promise<CustomModelPlatformRecord[]>
  getModel(modelId: string): Promise<CustomModelPlatformRecord | null>
  updateModel(modelId: string, updates: UpdateCustomModelPlatformPayload): Promise<void>
  deleteModel(modelId: string): Promise<void>
}
