import {
  getProviderKeyInfo,
  getLlmProviderKeyStatus,
  removeAiProviderApiKey,
  setAiProviderApiKey,
} from '../services/keystore'
import { parseRecord, registerIpcHandler } from './registry'
import type { ProviderKeyInfo } from '../../../src/core/providerKeyInfo'

interface ProviderKeyPayload {
  providerId: string
}

interface SetProviderKeyPayload extends ProviderKeyPayload {
  apiKey: string
}

interface CredentialIdsPayload {
  credentialIds: string[]
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

function parseCredentialIdsPayload(input: unknown): CredentialIdsPayload {
  const record = parseRecord(input)
  const credentialIds = record.credentialIds
  if (!Array.isArray(credentialIds)
    || !credentialIds.every((id): id is string => typeof id === 'string' && id.trim().length > 0)) {
    throw new Error('Expected credentialIds string array')
  }
  return { credentialIds }
}

export function registerKeystoreIpc(): void {
  registerIpcHandler<SetProviderKeyPayload, void>('ai:setProviderApiKey', parseSetProviderKeyPayload, ({ providerId, apiKey }) => {
    setAiProviderApiKey(providerId, apiKey)
  })

  registerIpcHandler<ProviderKeyPayload, void>('ai:removeProviderApiKey', parseProviderKeyPayload, ({ providerId }) => {
    removeAiProviderApiKey(providerId)
  })

  registerIpcHandler<ProviderKeyPayload, ProviderKeyInfo>('ai:getProviderKeyInfo', parseProviderKeyPayload, ({ providerId }) => {
    return getProviderKeyInfo(providerId)
  })

  registerIpcHandler<CredentialIdsPayload, Array<{ credentialId: string; configured: boolean }>>(
    'llm:getProviderKeyStatus',
    parseCredentialIdsPayload,
    ({ credentialIds }) => getLlmProviderKeyStatus(credentialIds)
  )
}
