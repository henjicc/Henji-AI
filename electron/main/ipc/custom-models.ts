import {
  deleteCustomModel,
  getCustomModel,
  insertCustomModel,
  listCustomModels,
  updateCustomModel,
  type CustomModelRecordDto,
  type InsertCustomModelDto,
  type UpdateCustomModelDto,
} from '../services/custom-models'
import { parseOptionalStringField, parseRecord, parseStringField, registerIpcHandler } from './registry'

type JsonObject = Record<string, unknown>

interface ProviderPayload {
  providerId?: string
}

interface ModelIdPayload {
  modelId: string
}

interface UpdateCustomModelPayload extends ModelIdPayload {
  updates: UpdateCustomModelDto
}

function parseJsonObject(value: unknown, field: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected object field "${field}"`)
  }
  return value as JsonObject
}

function parseInsertPayload(input: unknown): InsertCustomModelDto {
  const record = parseRecord(input)
  const id = record.id
  const name = record.name
  const providerId = record.providerId
  const baseModel = record.baseModel
  const isEnabled = record.isEnabled

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Expected non-empty custom model id')
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Expected non-empty custom model name')
  }
  if (typeof providerId !== 'string' || providerId.length === 0) {
    throw new Error('Expected non-empty custom model providerId')
  }
  if (baseModel !== null && baseModel !== undefined && typeof baseModel !== 'string') {
    throw new Error('Expected custom model baseModel string or null')
  }
  if (typeof isEnabled !== 'boolean') {
    throw new Error('Expected custom model isEnabled boolean')
  }

  return {
    id,
    name: name.trim(),
    providerId,
    baseModel: baseModel ?? null,
    config: parseJsonObject(record.config, 'config'),
    isEnabled,
  }
}

function parseProviderPayload(input: unknown): ProviderPayload {
  return { providerId: parseOptionalStringField(input, 'providerId') }
}

function parseModelIdPayload(input: unknown): ModelIdPayload {
  return { modelId: parseStringField(input, 'modelId') }
}

function parseUpdatePayload(input: unknown): UpdateCustomModelPayload {
  const record = parseRecord(input)
  const modelId = record.modelId
  const rawUpdates = record.updates

  if (typeof modelId !== 'string' || modelId.length === 0) {
    throw new Error('Expected non-empty custom model modelId')
  }

  const updatesRecord = parseJsonObject(rawUpdates, 'updates')
  const updates: UpdateCustomModelDto = {}

  if (updatesRecord.name !== undefined) {
    if (typeof updatesRecord.name !== 'string' || updatesRecord.name.trim().length === 0) {
      throw new Error('Expected custom model update name to be a non-empty string')
    }
    updates.name = updatesRecord.name.trim()
  }
  if (updatesRecord.config !== undefined) {
    updates.config = parseJsonObject(updatesRecord.config, 'updates.config')
  }
  if (updatesRecord.isEnabled !== undefined) {
    if (typeof updatesRecord.isEnabled !== 'boolean') {
      throw new Error('Expected custom model update isEnabled boolean')
    }
    updates.isEnabled = updatesRecord.isEnabled
  }

  return { modelId, updates }
}

export function registerCustomModelsIpc(): void {
  registerIpcHandler<InsertCustomModelDto, void>('customModels:insert', parseInsertPayload, (model) => {
    insertCustomModel(model)
  })
  registerIpcHandler<ProviderPayload, CustomModelRecordDto[]>('customModels:list', parseProviderPayload, ({ providerId }) => {
    return listCustomModels(providerId)
  })
  registerIpcHandler<ModelIdPayload, CustomModelRecordDto | null>('customModels:get', parseModelIdPayload, ({ modelId }) => {
    return getCustomModel(modelId)
  })
  registerIpcHandler<UpdateCustomModelPayload, void>('customModels:update', parseUpdatePayload, ({ modelId, updates }) => {
    updateCustomModel(modelId, updates)
  })
  registerIpcHandler<ModelIdPayload, void>('customModels:delete', parseModelIdPayload, ({ modelId }) => {
    deleteCustomModel(modelId)
  })
}
