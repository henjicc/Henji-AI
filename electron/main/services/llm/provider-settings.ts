import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_PPIO_BASE_URL,
  createProviderFromPreset,
  findLlmProviderPreset,
  normalizeLlmProviderSetup,
  resolveLlmEndpointIdentity,
  resolveLlmProviderApiKeyUrl,
  type LlmConfigState,
  type LlmModelConfig,
  type LlmProviderConfig,
} from '@henjicc/ai-sdk'

import {
  LLM_KEY_NAMESPACE,
  captureEncryptedKeySnapshot,
  getLlmProviderApiKey,
  removeLlmProviderApiKey,
  restoreEncryptedKeySnapshot,
  setLlmProviderApiKey,
  type EncryptedKeySnapshot,
} from '../keystore'
import { createMainLogger } from '../logging'
import {
  createProviderSettingsFileStorage,
  type ProviderSettingsJournal,
  type ProviderSettingsStorage,
} from './provider-settings-storage'

const logger = createMainLogger('main.llm.provider-settings')
const FORBIDDEN_PLAINTEXT_CREDENTIAL_FIELDS = new Set([
  'apikey', 'authorization', 'token', 'accesstoken', 'refreshtoken', 'secret', 'clientsecret', 'password',
])

export type LlmCredentialMutation =
  | { kind: 'unchanged' }
  | { kind: 'set'; apiKey: string }
  | { kind: 'remove' }

export interface CommitLlmProviderSettingsRequest {
  provider: LlmProviderConfig
  seedModels: LlmModelConfig[]
  baselineConfig: LlmConfigState
  credential: LlmCredentialMutation
}

export interface DeleteLlmProviderSettingsRequest {
  providerId: string
  baselineConfig: LlmConfigState
}

export interface LlmProviderSettingsResult {
  config: LlmConfigState
  providerId: string
  credentialId: string
  configured: boolean
  apiKeyUrl: string | null
  credentialAction: 'unchanged' | 'set' | 'removed' | 'preserved_shared'
  rollbackStatus: 'not-needed' | 'completed'
}

interface CredentialTransactions {
  capture(credentialId: string): EncryptedKeySnapshot
  set(credentialId: string, apiKey: string): void
  remove(credentialId: string): void
  restore(snapshot: EncryptedKeySnapshot): void
  configured(credentialId: string): boolean
}

export interface LlmProviderSettingsDependencies {
  storage: ProviderSettingsStorage
  credentials: CredentialTransactions
}

const defaultDependencies = (): LlmProviderSettingsDependencies => ({
  storage: createProviderSettingsFileStorage(),
  credentials: {
    capture: credentialId => captureEncryptedKeySnapshot(LLM_KEY_NAMESPACE, credentialId),
    set: setLlmProviderApiKey,
    remove: removeLlmProviderApiKey,
    restore: restoreEncryptedKeySnapshot,
    configured: credentialId => getLlmProviderApiKey(credentialId) !== null,
  },
})

function requireConfigShape(config: LlmConfigState): LlmConfigState {
  if (!config || !Array.isArray(config.providers) || !Array.isArray(config.models)
    || !Array.isArray(config.promptProfiles) || !Array.isArray(config.agentProfiles)) {
    throw new Error('[llm_config_invalid] LLM config is incomplete; reload settings and retry')
  }
  config.providers.forEach((provider, index) => rejectPlaintextCredentialFields(
    provider, `config.providers[${index}]`
  ))
  config.models.forEach((model, index) => rejectPlaintextCredentialFields(
    model, `config.models[${index}]`
  ))
  return config
}

function rejectPlaintextCredentialFields(value: object, label: string): void {
  const field = Object.keys(value).find(key => (
    FORBIDDEN_PLAINTEXT_CREDENTIAL_FIELDS.has(key.replace(/[_-]/g, '').toLowerCase())
  ))
  if (field) {
    throw new Error(`[llm_plaintext_credential_forbidden] "${label}.${field}" must use the credential mutation field instead`)
  }
}

function normalizeProviderForCommit(provider: LlmProviderConfig): LlmProviderConfig {
  rejectPlaintextCredentialFields(provider, 'provider')
  if (!provider.providerId.trim() || !provider.displayName.trim() || !provider.adapter.trim()) {
    throw new Error('[llm_provider_settings_invalid] providerId, displayName, and adapter are required; correct the provider form and retry')
  }
  if (!provider.setup) {
    throw new Error('[llm_provider_setup_required] choose a registered preset or custom provider setup and retry')
  }
  const setup = normalizeLlmProviderSetup(provider.setup)
  if (setup.kind === 'preset') {
    const preset = findLlmProviderPreset(setup.presetId)
    if (!preset) throw new Error(`[llm_provider_preset_unknown] preset "${setup.presetId}" is unavailable`)
    const canonical = createProviderFromPreset(preset, {
      providerId: provider.providerId,
      endpointProfile: provider.endpointProfile,
      lifecycle: setup.lifecycle,
    })
    return {
      ...canonical,
      displayName: provider.displayName.trim(),
      enabled: provider.enabled,
      reasoning: provider.reasoning ?? canonical.reasoning,
    }
  }
  const identity = resolveLlmEndpointIdentity(provider)
  return {
    ...provider,
    providerId: identity.providerId,
    providerFamilyId: identity.providerFamilyId,
    endpointProfile: identity.endpointProfile,
    credentialId: identity.credentialId,
    baseUrl: identity.baseUrl,
    displayName: provider.displayName.trim(),
    adapter: provider.adapter.trim().toLowerCase(),
    setup,
  }
}

function mergeProvider(
  config: LlmConfigState,
  provider: LlmProviderConfig,
  seedModels: LlmModelConfig[]
): LlmConfigState {
  const providers = config.providers.filter(item => item.providerId !== provider.providerId)
  providers.push(provider)
  const models = config.models.map(model => (
    model.providerId === provider.providerId
      ? {
          ...model,
          providerFamilyId: provider.providerFamilyId,
          endpointProfile: provider.endpointProfile,
          credentialId: provider.credentialId,
          adapter: provider.adapter,
          apiProtocol: provider.apiProtocol,
          baseUrl: provider.baseUrl,
        }
      : model
  ))
  for (const model of seedModels) {
    rejectPlaintextCredentialFields(model, `seedModels:${model.modelId}`)
    if (model.providerId !== provider.providerId) {
      throw new Error(`[llm_provider_seed_invalid] model "${model.modelId}" must use provider "${provider.providerId}"`)
    }
    if (!models.some(item => item.providerId === model.providerId && item.modelId === model.modelId)) {
      models.push({
        ...model,
        providerFamilyId: provider.providerFamilyId,
        endpointProfile: provider.endpointProfile,
        credentialId: provider.credentialId,
        baseUrl: provider.baseUrl,
      })
    }
  }
  return { ...config, providers, models }
}

function dependencyReferences(config: LlmConfigState, providerId: string): string[] {
  const references = config.promptProfiles
    .filter(profile => profile.providerId === providerId)
    .map(profile => `promptProfiles:${profile.id}`)
  for (const profile of config.agentProfiles) {
    for (const role of ['primary', 'router', 'summarizer', 'fallback', 'observer'] as const) {
      if (profile[role]?.providerId === providerId) references.push(`agentProfiles:${profile.id}.${role}`)
    }
  }
  return references
}

function isLegacyBuiltIn(provider: LlmProviderConfig): boolean {
  const baseUrl = provider.baseUrl?.replace(/\/+$/, '')
  return (provider.providerId === 'ppio' && baseUrl === DEFAULT_PPIO_BASE_URL)
    || (provider.providerId === 'deepseek' && baseUrl === DEFAULT_DEEPSEEK_BASE_URL)
}

function isBuiltIn(provider: LlmProviderConfig): boolean {
  return provider.setup?.kind === 'preset' && provider.setup.lifecycle === 'builtin'
    || (!provider.setup && isLegacyBuiltIn(provider))
}

export class LlmProviderSettingsService {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: LlmProviderSettingsDependencies = defaultDependencies()) {}

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.then(() => undefined, () => undefined)
    return await next
  }

  private async recoverIfNeeded(): Promise<void> {
    const journal = await this.dependencies.storage.readJournal()
    if (!journal) return
    if (journal.version !== 1) {
      throw new Error('[llm_provider_transaction_recovery_failed] unsupported transaction journal; update the app before retrying')
    }
    if (journal.credentialBefore) this.dependencies.credentials.restore(journal.credentialBefore)
    if (journal.configBefore) await this.dependencies.storage.writeConfig(journal.configBefore)
    else await this.dependencies.storage.removeConfig()
    await this.dependencies.storage.removeJournal()
    logger.warn('恢复了未完成的供应商设置事务', {
      event: 'llm_provider_settings.recovered',
      context: { rollbackStatus: 'completed' },
    })
  }

  private async loadConfig(baseline: LlmConfigState): Promise<{
    current: LlmConfigState
    persistedBefore: LlmConfigState | null
  }> {
    const persistedBefore = await this.dependencies.storage.readConfig()
    return {
      current: requireConfigShape(persistedBefore ?? baseline),
      persistedBefore,
    }
  }

  private async rollback(journal: ProviderSettingsJournal): Promise<void> {
    if (journal.credentialBefore) this.dependencies.credentials.restore(journal.credentialBefore)
    if (journal.configBefore) await this.dependencies.storage.writeConfig(journal.configBefore)
    else await this.dependencies.storage.removeConfig()
    await this.dependencies.storage.removeJournal()
  }

  async readConfig(): Promise<LlmConfigState | null> {
    return await this.exclusive(async () => {
      await this.recoverIfNeeded()
      return await this.dependencies.storage.readConfig()
    })
  }

  async writeConfig(config: LlmConfigState): Promise<void> {
    await this.exclusive(async () => {
      await this.recoverIfNeeded()
      await this.dependencies.storage.writeConfig(requireConfigShape(config))
    })
  }

  async commit(request: CommitLlmProviderSettingsRequest): Promise<LlmProviderSettingsResult> {
    return await this.exclusive(async () => {
      await this.recoverIfNeeded()
      const { current, persistedBefore } = await this.loadConfig(request.baselineConfig)
      const provider = normalizeProviderForCommit(request.provider)
      const credentialId = provider.credentialId!
      const next = mergeProvider(current, provider, request.seedModels)
      const credentialBefore = request.credential.kind === 'unchanged'
        ? undefined
        : this.dependencies.credentials.capture(credentialId)
      const journal: ProviderSettingsJournal = { version: 1, configBefore: persistedBefore, credentialBefore }
      logger.info('开始提交供应商与凭据设置', {
        event: 'llm_provider_settings.commit.started',
        context: { providerId: provider.providerId, credentialId, credentialMutation: request.credential.kind },
      })
      await this.dependencies.storage.writeJournal(journal)
      try {
        if (request.credential.kind === 'set') {
          const apiKey = request.credential.apiKey.trim()
          if (!apiKey) throw new Error('[llm_credential_invalid] API key must not be empty; choose remove to clear it')
          this.dependencies.credentials.set(credentialId, apiKey)
        } else if (request.credential.kind === 'remove') {
          this.dependencies.credentials.remove(credentialId)
        }
        await this.dependencies.storage.writeConfig(next)
        await this.dependencies.storage.removeJournal()
      } catch (error) {
        try {
          await this.rollback(journal)
        } catch (rollbackError) {
          logger.error('供应商设置事务与补偿均失败', {
            event: 'llm_provider_settings.commit.failed',
            context: { providerId: provider.providerId, credentialId, rollbackStatus: 'failed' },
            error: rollbackError,
          })
          throw new Error('[llm_provider_transaction_rollback_failed] settings could not be restored; restart the app to retry journal recovery')
        }
        logger.error('供应商设置事务失败，已恢复旧配置', {
          event: 'llm_provider_settings.commit.failed',
          context: { providerId: provider.providerId, credentialId, rollbackStatus: 'completed' },
          error,
        })
        throw new Error('[llm_provider_settings_commit_failed] previous settings were restored; correct the provider fields or retry')
      }
      const result: LlmProviderSettingsResult = {
        config: next,
        providerId: provider.providerId,
        credentialId,
        configured: this.dependencies.credentials.configured(credentialId),
        apiKeyUrl: resolveLlmProviderApiKeyUrl(provider),
        credentialAction: request.credential.kind === 'unchanged'
          ? 'unchanged'
          : request.credential.kind === 'set' ? 'set' : 'removed',
        rollbackStatus: 'not-needed',
      }
      logger.info('供应商与凭据设置已提交', {
        event: 'llm_provider_settings.commit.completed',
        context: {
          providerId: result.providerId,
          credentialId: result.credentialId,
          configured: result.configured,
          credentialAction: result.credentialAction,
        },
      })
      return result
    })
  }

  async delete(request: DeleteLlmProviderSettingsRequest): Promise<LlmProviderSettingsResult> {
    return await this.exclusive(async () => {
      await this.recoverIfNeeded()
      const { current, persistedBefore } = await this.loadConfig(request.baselineConfig)
      const providerId = request.providerId.trim().toLowerCase()
      const provider = current.providers.find(item => item.providerId === providerId)
      if (!provider) {
        throw new Error(`[llm_provider_not_found] provider "${providerId}" does not exist; reload settings and retry`)
      }
      if (isBuiltIn(provider)) {
        throw new Error(`[llm_provider_builtin_delete_forbidden] built-in provider "${providerId}" cannot be deleted; set enabled=false to disable it or save its preset defaults to reset it`)
      }
      const references = dependencyReferences(current, providerId)
      if (references.length > 0) {
        throw new Error(`[llm_provider_in_use] provider "${providerId}" is still referenced; switch these entries first: ${references.join(', ')}`)
      }
      const identity = resolveLlmEndpointIdentity(provider)
      const credentialId = identity.credentialId
      const shared = current.providers.some(item => (
        item.providerId !== providerId
        && resolveLlmEndpointIdentity(item).credentialId === credentialId
      ))
      const next: LlmConfigState = {
        ...current,
        providers: current.providers.filter(item => item.providerId !== providerId),
        models: current.models.filter(item => item.providerId !== providerId),
      }
      const credentialBefore = shared ? undefined : this.dependencies.credentials.capture(credentialId)
      const journal: ProviderSettingsJournal = { version: 1, configBefore: persistedBefore, credentialBefore }
      logger.info('开始删除自定义供应商设置', {
        event: 'llm_provider_settings.delete.started',
        context: { providerId, credentialId, sharedCredential: shared },
      })
      await this.dependencies.storage.writeJournal(journal)
      try {
        if (!shared) this.dependencies.credentials.remove(credentialId)
        await this.dependencies.storage.writeConfig(next)
        await this.dependencies.storage.removeJournal()
      } catch (error) {
        try {
          await this.rollback(journal)
        } catch (rollbackError) {
          logger.error('删除供应商事务与补偿均失败', {
            event: 'llm_provider_settings.delete.failed',
            context: { providerId, credentialId, rollbackStatus: 'failed' },
            error: rollbackError,
          })
          throw new Error('[llm_provider_transaction_rollback_failed] settings could not be restored; restart the app to retry journal recovery')
        }
        logger.error('删除供应商失败，已恢复旧配置', {
          event: 'llm_provider_settings.delete.failed',
          context: { providerId, credentialId, rollbackStatus: 'completed' },
          error,
        })
        throw new Error('[llm_provider_settings_delete_failed] previous settings were restored; reload dependencies and retry')
      }
      const result: LlmProviderSettingsResult = {
        config: next,
        providerId,
        credentialId,
        configured: shared && this.dependencies.credentials.configured(credentialId),
        apiKeyUrl: null,
        credentialAction: shared ? 'preserved_shared' : 'removed',
        rollbackStatus: 'not-needed',
      }
      logger.info('自定义供应商设置已删除', {
        event: 'llm_provider_settings.delete.completed',
        context: { providerId, credentialId, credentialAction: result.credentialAction },
      })
      return result
    })
  }
}

export const llmProviderSettingsService = new LlmProviderSettingsService()
