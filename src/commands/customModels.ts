import { getPlatform } from '@/platform'
import type {
  CustomModelPlatformRecord,
  InsertCustomModelPlatformPayload,
  UpdateCustomModelPlatformPayload,
} from '@/platform/contracts/customModels'

export async function insertCustomModel(model: InsertCustomModelPlatformPayload): Promise<void> {
  await getPlatform().customModels.insertModel(model)
}

export async function listCustomModels(providerId?: string): Promise<CustomModelPlatformRecord[]> {
  return await getPlatform().customModels.listModels(providerId)
}

export async function getCustomModel(modelId: string): Promise<CustomModelPlatformRecord | null> {
  return await getPlatform().customModels.getModel(modelId)
}

export async function updateCustomModel(
  modelId: string,
  updates: UpdateCustomModelPlatformPayload
): Promise<void> {
  await getPlatform().customModels.updateModel(modelId, updates)
}

export async function deleteCustomModel(modelId: string): Promise<void> {
  await getPlatform().customModels.deleteModel(modelId)
}
