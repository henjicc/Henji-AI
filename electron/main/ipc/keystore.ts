import {
  getAiProviderApiKey,
  getAiProviderKeyStatus,
  getKey,
  getLlmProviderApiKey,
  getLlmProviderKeyStatus,
  hasKey,
  removeAiProviderApiKey,
  removeKey,
  removeLlmProviderApiKey,
  setAiProviderApiKey,
  setKey,
  setLlmProviderApiKey,
} from '../services/keystore'
import { parseRecord, registerIpcHandler } from './registry'

interface ProviderKeyPayload {
  providerId: string
}

interface SetProviderKeyPayload extends ProviderKeyPayload {
  apiKey: string
}

interface NamespacedKeyPayload extends ProviderKeyPayload {
  namespace: string
}

interface SetNamespacedKeyPayload extends NamespacedKeyPayload {
  apiKey: string
}

interface ProviderIdsPayload {
  providerIds: string[]
}

function readStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

function parseProviderKeyPayload(input: unknown): ProviderKeyPayload {
  const record = parseRecord(input)
  return { providerId: readStringField(record, 'providerId') }
}

function parseSetProviderKeyPayload(input: unknown): SetProviderKeyPayload {
  const record = parseRecord(input)
  return {
    providerId: readStringField(record, 'providerId'),
    apiKey: readStringField(record, 'apiKey'),
  }
}

function parseNamespacedKeyPayload(input: unknown): NamespacedKeyPayload {
  const record = parseRecord(input)
  return {
    namespace: readStringField(record, 'namespace'),
    providerId: readStringField(record, 'providerId'),
  }
}

function parseSetNamespacedKeyPayload(input: unknown): SetNamespacedKeyPayload {
  const record = parseRecord(input)
  return {
    namespace: readStringField(record, 'namespace'),
    providerId: readStringField(record, 'providerId'),
    apiKey: readStringField(record, 'apiKey'),
  }
}

function parseProviderIdsPayload(input: unknown): ProviderIdsPayload {
  const record = parseRecord(input)
  const providerIds = record.providerIds
  if (
    !Array.isArray(providerIds) ||
    !providerIds.every((providerId): providerId is string => typeof providerId === 'string' && providerId.trim().length > 0)
  ) {
    throw new Error('Expected providerIds string array')
  }
  return { providerIds }
}

export function registerKeystoreIpc(): void {
  registerIpcHandler<SetNamespacedKeyPayload, void>('keystore:set', parseSetNamespacedKeyPayload, ({ namespace, providerId, apiKey }) => {
    setKey(namespace, providerId, apiKey)
  })

  registerIpcHandler<NamespacedKeyPayload, void>('keystore:remove', parseNamespacedKeyPayload, ({ namespace, providerId }) => {
    removeKey(namespace, providerId)
  })

  registerIpcHandler<NamespacedKeyPayload, string | null>('keystore:get', parseNamespacedKeyPayload, ({ namespace, providerId }) => {
    return getKey(namespace, providerId)
  })

  registerIpcHandler<NamespacedKeyPayload, boolean>('keystore:has', parseNamespacedKeyPayload, ({ namespace, providerId }) => {
    return hasKey(namespace, providerId)
  })

  registerIpcHandler<SetProviderKeyPayload, void>('ai:setProviderApiKey', parseSetProviderKeyPayload, ({ providerId, apiKey }) => {
    setAiProviderApiKey(providerId, apiKey)
  })

  registerIpcHandler<ProviderKeyPayload, void>('ai:removeProviderApiKey', parseProviderKeyPayload, ({ providerId }) => {
    removeAiProviderApiKey(providerId)
  })

  registerIpcHandler<ProviderKeyPayload, string | null>('ai:getProviderApiKey', parseProviderKeyPayload, ({ providerId }) => {
    return getAiProviderApiKey(providerId)
  })

  registerIpcHandler('ai:getProviderKeyStatus', (input: unknown): void => {
    if (input !== undefined) {
      throw new Error('Expected no IPC payload')
    }
  }, () => {
    return getAiProviderKeyStatus()
  })

  registerIpcHandler<SetProviderKeyPayload, void>('llm:setProviderApiKey', parseSetProviderKeyPayload, ({ providerId, apiKey }) => {
    setLlmProviderApiKey(providerId, apiKey)
  })

  registerIpcHandler<ProviderKeyPayload, void>('llm:removeProviderApiKey', parseProviderKeyPayload, ({ providerId }) => {
    removeLlmProviderApiKey(providerId)
  })

  registerIpcHandler<ProviderKeyPayload, string | null>('llm:getProviderApiKey', parseProviderKeyPayload, ({ providerId }) => {
    return getLlmProviderApiKey(providerId)
  })

  registerIpcHandler<ProviderIdsPayload, Array<{ providerId: string; configured: boolean }>>(
    'llm:getProviderKeyStatus',
    parseProviderIdsPayload,
    ({ providerIds }) => getLlmProviderKeyStatus(providerIds)
  )
}
