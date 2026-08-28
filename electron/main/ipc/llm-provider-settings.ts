import type { LlmConfigState, LlmModelConfig, LlmProviderConfig } from '@henjicc/ai-sdk'

import {
  llmProviderSettingsService,
  type CommitLlmProviderSettingsRequest,
  type DeleteLlmProviderSettingsRequest,
  type LlmCredentialMutation,
  type LlmProviderSettingsResult,
} from '../services/llm/provider-settings'
import { parseRecord, parseVoid, registerIpcHandler } from './registry'

const FORBIDDEN_PLAINTEXT_CREDENTIAL_FIELDS = new Set([
  'apikey', 'authorization', 'token', 'accesstoken', 'refreshtoken', 'secret', 'clientsecret', 'password',
])

function rejectPlaintextCredentialFields(record: Record<string, unknown>, label: string): void {
  const field = Object.keys(record).find(key => (
    FORBIDDEN_PLAINTEXT_CREDENTIAL_FIELDS.has(key.replace(/[_-]/g, '').toLowerCase())
  ))
  if (field) {
    throw new Error(`[llm_plaintext_credential_forbidden] "${label}.${field}" must use the credential mutation field instead`)
  }
}

function parseConfig(input: unknown): LlmConfigState {
  const value = parseRecord(input)
  for (const field of ['providers', 'models', 'promptProfiles', 'agentProfiles'] as const) {
    if (!Array.isArray(value[field])) {
      throw new Error(`[llm_config_invalid] expected array field "${field}"; reload settings and retry`)
    }
  }
  ;(value.providers as unknown[]).forEach((item, index) => rejectPlaintextCredentialFields(
    parseRecord(item), `config.providers[${index}]`
  ))
  ;(value.models as unknown[]).forEach((item, index) => rejectPlaintextCredentialFields(
    parseRecord(item), `config.models[${index}]`
  ))
  return value as unknown as LlmConfigState
}

function readRequiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[llm_provider_settings_invalid] expected non-empty "${field}"; correct the provider form and retry`)
  }
  return value
}

function parseProvider(input: unknown): LlmProviderConfig {
  const value = parseRecord(input)
  rejectPlaintextCredentialFields(value, 'provider')
  readRequiredString(value, 'providerId')
  readRequiredString(value, 'displayName')
  readRequiredString(value, 'adapter')
  if (typeof value.enabled !== 'boolean') {
    throw new Error('[llm_provider_settings_invalid] expected boolean "enabled"; correct the provider form and retry')
  }
  if (typeof value.setup !== 'object' || value.setup === null || Array.isArray(value.setup)) {
    throw new Error('[llm_provider_setup_required] choose a registered preset or custom provider setup and retry')
  }
  return value as unknown as LlmProviderConfig
}

function parseModels(input: unknown): LlmModelConfig[] {
  if (!Array.isArray(input)) {
    throw new Error('[llm_provider_settings_invalid] expected seedModels array; reload settings and retry')
  }
  return input.map((item, index) => {
    const value = parseRecord(item)
    rejectPlaintextCredentialFields(value, `seedModels[${index}]`)
    readRequiredString(value, 'providerId')
    readRequiredString(value, 'modelId')
    return value as unknown as LlmModelConfig
  })
}

function parseCredential(input: unknown): LlmCredentialMutation {
  const value = parseRecord(input)
  if (value.kind === 'unchanged' || value.kind === 'remove') return { kind: value.kind }
  if (value.kind === 'set') {
    if (typeof value.apiKey !== 'string' || !value.apiKey.trim()) {
      throw new Error('[llm_credential_invalid] API key must not be empty; choose remove to clear it')
    }
    return { kind: 'set', apiKey: value.apiKey }
  }
  throw new Error('[llm_credential_mutation_invalid] choose unchanged, set, or remove and retry')
}

function parseCommit(input: unknown): CommitLlmProviderSettingsRequest {
  const value = parseRecord(input)
  return {
    provider: parseProvider(value.provider),
    seedModels: parseModels(value.seedModels),
    baselineConfig: parseConfig(value.baselineConfig),
    credential: parseCredential(value.credential),
  }
}

function parseDelete(input: unknown): DeleteLlmProviderSettingsRequest {
  const value = parseRecord(input)
  return {
    providerId: readRequiredString(value, 'providerId'),
    baselineConfig: parseConfig(value.baselineConfig),
  }
}

function parseWriteConfig(input: unknown): LlmConfigState {
  return parseConfig(parseRecord(input).config)
}

export function registerLlmProviderSettingsIpc(): void {
  registerIpcHandler<void, LlmConfigState | null>(
    'llm:providerSettings:readConfig',
    parseVoid,
    async () => await llmProviderSettingsService.readConfig()
  )
  registerIpcHandler<LlmConfigState, void>(
    'llm:providerSettings:writeConfig',
    parseWriteConfig,
    async config => await llmProviderSettingsService.writeConfig(config)
  )
  registerIpcHandler<CommitLlmProviderSettingsRequest, LlmProviderSettingsResult>(
    'llm:providerSettings:commit',
    parseCommit,
    async request => await llmProviderSettingsService.commit(request)
  )
  registerIpcHandler<DeleteLlmProviderSettingsRequest, LlmProviderSettingsResult>(
    'llm:providerSettings:delete',
    parseDelete,
    async request => await llmProviderSettingsService.delete(request)
  )
}
