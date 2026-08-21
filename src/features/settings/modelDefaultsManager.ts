import { registry } from '@/core/ModelRegistry'
import { createLogger } from '@/core/logging'
import type { ModelDefinition, ModelTag } from '@/core/types'
import {
  API_KEY_PROVIDERS,
  type ApiKeyProvider,
} from '@/core/config/providers'

export type DefaultModelMediaType = 'image' | 'video' | 'audio'

export const MODEL_DEFAULTS_STORAGE_KEY = 'henji-model-defaults'
export const MODEL_DEFAULTS_STATE_VERSION = 1

const DEFAULT_PROVIDER: ApiKeyProvider = 'kie'
const MEDIA_TYPES: DefaultModelMediaType[] = ['image', 'video', 'audio']
const LEGACY_ONBOARDING_STORAGE_KEY = 'henji-onboarding-state'

const PREFERRED_CANONICAL_MODEL_IDS: Record<DefaultModelMediaType, string[]> = {
  image: ['nano-banana-2', 'nano-banana-pro', 'seedream-4.5', 'seedream-4.0'],
  video: [],
  audio: [],
}

const logger = createLogger('features.settings.model_defaults')
const providerIds = new Set<ApiKeyProvider>(API_KEY_PROVIDERS.map((provider) => provider.id))

export interface ModelDefaultsStateV1 {
  version: 1
  providerId: ApiKeyProvider
  models: Record<DefaultModelMediaType, string>
}

export interface ModelDefaultsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ModelDefaultsCatalog {
  getModelsByType(mediaType: DefaultModelMediaType): ModelDefinition[]
}

function createInitialState(storage: ModelDefaultsStorage): ModelDefaultsStateV1 {
  let providerId = DEFAULT_PROVIDER
  const legacyOnboarding = storage.getItem(LEGACY_ONBOARDING_STORAGE_KEY)
  if (legacyOnboarding) {
    try {
      const raw = JSON.parse(legacyOnboarding) as Record<string, unknown>
      if (typeof raw.primaryProvider === 'string' && providerIds.has(raw.primaryProvider as ApiKeyProvider)) {
        providerId = raw.primaryProvider as ApiKeyProvider
      }
    } catch {
      // 损坏的旧引导状态不影响新的默认项设置。
    }
  }
  return {
    version: MODEL_DEFAULTS_STATE_VERSION,
    providerId,
    models: { image: '', video: '', audio: '' },
  }
}

function normalizeState(value: unknown): ModelDefaultsStateV1 | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const rawModels = raw.models && typeof raw.models === 'object'
    ? raw.models as Record<string, unknown>
    : {}
  const providerId = raw.providerId
  if (typeof providerId !== 'string' || !providerIds.has(providerId as ApiKeyProvider)) return null
  return {
    version: MODEL_DEFAULTS_STATE_VERSION,
    providerId: providerId as ApiKeyProvider,
    models: {
      image: typeof rawModels.image === 'string' ? rawModels.image : '',
      video: typeof rawModels.video === 'string' ? rawModels.video : '',
      audio: typeof rawModels.audio === 'string' ? rawModels.audio : '',
    },
  }
}

function loadState(storage: ModelDefaultsStorage): ModelDefaultsStateV1 {
  const persisted = storage.getItem(MODEL_DEFAULTS_STORAGE_KEY)
  if (persisted) {
    try {
      const normalized = normalizeState(JSON.parse(persisted))
      if (normalized) return normalized
    } catch {
      // 损坏状态回退到安全默认值，不能阻塞应用启动。
    }
  }
  return createInitialState(storage)
}

function browserStorage(): ModelDefaultsStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

function matchesRequiredTags(model: ModelDefinition, requiredTags: ModelTag[]): boolean {
  return requiredTags.every((tag) => model.meta.tags?.includes(tag))
}

export class ModelDefaultsManager {
  private state: ModelDefaultsStateV1
  private snapshot: ModelDefaultsStateV1
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly storage: ModelDefaultsStorage,
    private readonly catalog: ModelDefaultsCatalog = registry,
  ) {
    this.state = loadState(storage)
    this.snapshot = this.copySnapshot()
    this.persist()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): ModelDefaultsStateV1 => this.snapshot

  listProviderModels(
    mediaType: DefaultModelMediaType,
    providerId = this.state.providerId,
    requiredTags: ModelTag[] = [],
  ): ModelDefinition[] {
    const seen = new Set<string>()
    return this.catalog.getModelsByType(mediaType).filter((model) => {
      if (model.meta.provider !== providerId || !matchesRequiredTags(model, requiredTags)) return false
      if (seen.has(model.meta.canonicalModelId)) return false
      seen.add(model.meta.canonicalModelId)
      return true
    })
  }

  setProvider(providerId: ApiKeyProvider): DefaultModelMediaType[] {
    if (!providerIds.has(providerId)) throw new Error(`DEFAULT_PROVIDER_NOT_AVAILABLE:${providerId}`)
    if (providerId === this.state.providerId) return []
    logger.info('默认供应商修改开始', {
      event: 'model_defaults.provider.change.start',
      providerId,
    })
    const clearedMediaTypes = MEDIA_TYPES.filter((mediaType) => {
      const canonicalModelId = this.state.models[mediaType]
      return Boolean(canonicalModelId)
        && !this.listProviderModels(mediaType, providerId)
          .some((model) => model.meta.canonicalModelId === canonicalModelId)
    })
    const previousState = this.state
    this.state = {
      ...this.state,
      providerId,
      models: {
        ...this.state.models,
        ...Object.fromEntries(clearedMediaTypes.map((mediaType) => [mediaType, ''])),
      },
    }
    try {
      this.commit()
    } catch (error) {
      this.state = previousState
      logger.error('默认供应商修改失败', error, {
        event: 'model_defaults.provider.change.failed',
        providerId,
      })
      throw error
    }
    logger.info('默认供应商修改完成', {
      event: 'model_defaults.provider.change.completed',
      providerId,
      clearedMediaTypes,
    })
    return clearedMediaTypes
  }

  setDefaultModel(mediaType: DefaultModelMediaType, canonicalModelId: string): void {
    const normalized = canonicalModelId.trim()
    const availableModels = this.listProviderModels(mediaType)
    if (normalized && !availableModels.some((model) => model.meta.canonicalModelId === normalized)) {
      const availableIds = availableModels.map((model) => model.meta.canonicalModelId)
      throw new Error(
        `DEFAULT_MODEL_NOT_AVAILABLE:${mediaType}:${normalized}:available=${availableIds.join(',') || 'none'}`,
      )
    }
    if (this.state.models[mediaType] === normalized) return
    logger.info('默认模型修改开始', {
      event: 'model_defaults.model.change.start',
      providerId: this.state.providerId,
      mediaType,
      canonicalModelId: normalized || null,
    })
    const previousState = this.state
    this.state = {
      ...this.state,
      models: { ...this.state.models, [mediaType]: normalized },
    }
    try {
      this.commit()
    } catch (error) {
      this.state = previousState
      logger.error('默认模型修改失败', error, {
        event: 'model_defaults.model.change.failed',
        providerId: previousState.providerId,
        mediaType,
        canonicalModelId: normalized || null,
      })
      throw error
    }
    logger.info('默认模型修改完成', {
      event: 'model_defaults.model.change.completed',
      providerId: this.state.providerId,
      mediaType,
      canonicalModelId: normalized || null,
    })
  }

  resolveModelId(mediaType: DefaultModelMediaType, requiredTags: ModelTag[] = []): string {
    const models = this.catalog
      .getModelsByType(mediaType)
      .filter((model) => matchesRequiredTags(model, requiredTags))
    const providerModels = models.filter((model) => model.meta.provider === this.state.providerId)
    const configuredCanonicalId = this.state.models[mediaType]

    if (configuredCanonicalId) {
      const configured = providerModels.find(
        (model) => model.meta.canonicalModelId === configuredCanonicalId,
      )
      if (configured) return configured.meta.id
    }

    for (const canonicalModelId of PREFERRED_CANONICAL_MODEL_IDS[mediaType]) {
      const preferred = providerModels.find(
        (model) => model.meta.canonicalModelId === canonicalModelId,
      )
      if (preferred) return preferred.meta.id
    }

    return providerModels[0]?.meta.id ?? models[0]?.meta.id ?? ''
  }

  private copySnapshot(): ModelDefaultsStateV1 {
    return { ...this.state, models: { ...this.state.models } }
  }

  private commit(): void {
    try {
      this.persist()
      this.snapshot = this.copySnapshot()
      this.listeners.forEach((listener) => listener())
    } catch (error) {
      logger.error('默认模型设置保存失败', error, {
        event: 'model_defaults.persist.failed',
      })
      throw error
    }
  }

  private persist(): void {
    this.storage.setItem(MODEL_DEFAULTS_STORAGE_KEY, JSON.stringify(this.state))
  }
}

export const modelDefaultsManager = new ModelDefaultsManager(browserStorage())
