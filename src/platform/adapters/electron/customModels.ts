import type {
  CustomModelPlatformRecord,
  CustomModelsPlatform,
  InsertCustomModelPlatformPayload,
  UpdateCustomModelPlatformPayload,
} from '@/platform/contracts/customModels'

const DOMAIN = 'customModels'

function getNativeCustomModels(): NonNullable<typeof window.henjiNative>['customModels'] {
  const native = window.henjiNative
  if (!native?.customModels) {
    throw new Error(`[platform:${DOMAIN}] henjiNative.customModels is not available`)
  }
  return native.customModels
}

function normalizeRecord(record: Awaited<ReturnType<NonNullable<typeof window.henjiNative>['customModels']['getModel']>> extends infer T ? NonNullable<T> : never): CustomModelPlatformRecord {
  return {
    ...record,
    config: record.config as DynamicValueMap,
  }
}

export function createElectronCustomModels(): CustomModelsPlatform {
  return {
    insertModel: (model: InsertCustomModelPlatformPayload) => getNativeCustomModels().insertModel(model),
    listModels: async (providerId?: string) => {
      const records = await getNativeCustomModels().listModels(providerId)
      return records.map(normalizeRecord)
    },
    getModel: async (modelId: string) => {
      const record = await getNativeCustomModels().getModel(modelId)
      return record ? normalizeRecord(record) : null
    },
    updateModel: (modelId: string, updates: UpdateCustomModelPlatformPayload) =>
      getNativeCustomModels().updateModel(modelId, updates),
    deleteModel: (modelId: string) => getNativeCustomModels().deleteModel(modelId),
  }
}
