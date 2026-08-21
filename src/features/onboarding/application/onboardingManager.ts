import { subscribeApplicationEvent } from '@/core/events/applicationEvents'
import {
  API_KEY_PROVIDERS,
  type ApiKeyProvider,
} from '@/core/config/providers'
import {
  ModelDefaultsManager,
  modelDefaultsManager,
  type DefaultModelMediaType,
} from '@/features/settings/modelDefaultsManager'

export const ONBOARDING_STORAGE_KEY = 'henji-onboarding-state'
export const ONBOARDING_STATE_VERSION = 2

export const ONBOARDING_STEP_IDS = [
  'welcome',
  'basics',
  'provider',
  'api-key',
  'first-task',
] as const

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number]
export type OnboardingStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped'
export type OnboardingEntryReason = 'fresh_install' | 'existing_install' | 'manual'

export interface OnboardingStateV2 {
  version: 2
  status: OnboardingStatus
  entryReason: OnboardingEntryReason
  activeStepId: OnboardingStepId
  completedStepIds: OnboardingStepId[]
  configuredProviders: ApiKeyProvider[]
  verifiedProviders: ApiKeyProvider[]
  shownHintIds: string[]
  firstTaskPrepared: boolean
  firstTaskCompleted: boolean
  startedAt: string | null
  completedAt: string | null
}

export interface OnboardingSnapshot extends OnboardingStateV2 {
  primaryProvider: ApiKeyProvider
  isOpen: boolean
}

export interface OnboardingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const LEGACY_INSTALLATION_KEYS = [
  'settings-storage',
  'theme-storage',
  'henji-assistant-ui',
  'max_history_count',
  'max_concurrent_tasks',
  'general_upload_provider',
  'hidden_models',
  'presets',
] as const

const providerIds = new Set<ApiKeyProvider>(API_KEY_PROVIDERS.map((provider) => provider.id))
const stepIds = new Set<OnboardingStepId>(ONBOARDING_STEP_IDS)

function nowIso(): string {
  return new Date().toISOString()
}

function createInitialState(entryReason: OnboardingEntryReason): OnboardingStateV2 {
  const existingInstall = entryReason === 'existing_install'
  return {
    version: ONBOARDING_STATE_VERSION,
    status: existingInstall ? 'completed' : 'not_started',
    entryReason,
    activeStepId: 'welcome',
    completedStepIds: existingInstall ? [...ONBOARDING_STEP_IDS] : [],
    configuredProviders: [],
    verifiedProviders: [],
    shownHintIds: [],
    firstTaskPrepared: false,
    firstTaskCompleted: false,
    startedAt: null,
    completedAt: existingInstall ? nowIso() : null,
  }
}

function readStringArray<TValue extends string>(
  value: unknown,
  allowed?: ReadonlySet<TValue>
): TValue[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is TValue => (
    typeof item === 'string' && (!allowed || allowed.has(item as TValue))
  ))))
}

function normalizePersistedState(value: unknown): OnboardingStateV2 | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const status = raw.status
  const activeStepId = raw.activeStepId
  if (
    status !== 'not_started'
    && status !== 'in_progress'
    && status !== 'completed'
    && status !== 'skipped'
  ) return null

  return {
    version: ONBOARDING_STATE_VERSION,
    status,
    entryReason: raw.entryReason === 'existing_install' || raw.entryReason === 'manual'
      ? raw.entryReason
      : 'fresh_install',
    activeStepId: typeof activeStepId === 'string' && stepIds.has(activeStepId as OnboardingStepId)
      ? activeStepId as OnboardingStepId
      : 'welcome',
    completedStepIds: readStringArray(raw.completedStepIds, stepIds),
    configuredProviders: readStringArray(raw.configuredProviders, providerIds),
    verifiedProviders: readStringArray(raw.verifiedProviders, providerIds),
    shownHintIds: readStringArray(raw.shownHintIds),
    firstTaskPrepared: raw.firstTaskPrepared === true,
    firstTaskCompleted: raw.firstTaskCompleted === true,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
  }
}

function hasLegacyInstallation(storage: OnboardingStorage): boolean {
  return LEGACY_INSTALLATION_KEYS.some((key) => storage.getItem(key) !== null)
}

function loadState(storage: OnboardingStorage): OnboardingStateV2 {
  const persisted = storage.getItem(ONBOARDING_STORAGE_KEY)
  if (persisted) {
    try {
      const normalized = normalizePersistedState(JSON.parse(persisted))
      if (normalized) return normalized
    } catch {
      // 损坏状态回退到安全的新安装流程；不会阻塞应用启动。
    }
  }
  return createInitialState(hasLegacyInstallation(storage) ? 'existing_install' : 'fresh_install')
}

function browserStorage(): OnboardingStorage {
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

export class OnboardingManager {
  private state: OnboardingStateV2
  private isOpen: boolean
  private snapshot: OnboardingSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly storage: OnboardingStorage,
    private readonly defaultsManager: ModelDefaultsManager = modelDefaultsManager,
  ) {
    this.state = loadState(storage)
    this.isOpen = this.state.status === 'not_started' || this.state.status === 'in_progress'
    this.snapshot = this.createSnapshot()
    this.defaultsManager.subscribe(() => this.publish())
    this.persist()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): OnboardingSnapshot => this.snapshot

  open(): void {
    if (this.state.status === 'completed' || this.state.status === 'skipped') {
      this.restart()
      return
    }
    this.isOpen = true
    if (this.state.status === 'not_started') {
      this.update({ status: 'in_progress', startedAt: nowIso() })
      return
    }
    this.publish()
  }

  restart(): void {
    this.state = {
      ...createInitialState('manual'),
      status: 'in_progress',
      entryReason: 'manual',
      configuredProviders: this.state.configuredProviders,
      verifiedProviders: this.state.verifiedProviders,
      startedAt: nowIso(),
    }
    this.isOpen = true
    this.commit()
  }

  defer(): void {
    this.isOpen = false
    this.publish()
  }

  skip(): void {
    this.isOpen = false
    this.update({ status: 'skipped', completedAt: nowIso() })
  }

  complete(): void {
    this.isOpen = false
    this.update({
      status: 'completed',
      completedStepIds: [...ONBOARDING_STEP_IDS],
      completedAt: nowIso(),
    })
  }

  goToStep(stepId: OnboardingStepId): void {
    this.update({ activeStepId: stepId })
  }

  next(): void {
    const currentIndex = ONBOARDING_STEP_IDS.indexOf(this.state.activeStepId)
    const completedStepIds = Array.from(new Set([
      ...this.state.completedStepIds,
      this.state.activeStepId,
    ]))
    const nextStepId = ONBOARDING_STEP_IDS[currentIndex + 1]
    if (!nextStepId) {
      this.complete()
      return
    }
    this.update({ activeStepId: nextStepId, completedStepIds })
  }

  back(): void {
    const currentIndex = ONBOARDING_STEP_IDS.indexOf(this.state.activeStepId)
    const previousStepId = ONBOARDING_STEP_IDS[Math.max(0, currentIndex - 1)]
    this.update({ activeStepId: previousStepId })
  }

  setPrimaryProvider(providerId: ApiKeyProvider): DefaultModelMediaType[] {
    return this.defaultsManager.setProvider(providerId)
  }

  reconcileConfiguredProviders(status: Partial<Record<ApiKeyProvider, boolean>>): void {
    const configuredProviders = API_KEY_PROVIDERS
      .filter((provider) => status[provider.id] === true)
      .map((provider) => provider.id)
    this.update({ configuredProviders })
  }

  markProviderConfigured(providerId: string): void {
    if (!providerIds.has(providerId as ApiKeyProvider)) return
    this.update({
      configuredProviders: Array.from(new Set([
        ...this.state.configuredProviders,
        providerId as ApiKeyProvider,
      ])),
    })
  }

  markProviderRemoved(providerId: string): void {
    if (!providerIds.has(providerId as ApiKeyProvider)) return
    this.update({
      configuredProviders: this.state.configuredProviders.filter((item) => item !== providerId),
      verifiedProviders: this.state.verifiedProviders.filter((item) => item !== providerId),
    })
  }

  markProviderConnection(providerId: string, verified: boolean): void {
    if (!providerIds.has(providerId as ApiKeyProvider)) return
    const provider = providerId as ApiKeyProvider
    this.update({
      configuredProviders: Array.from(new Set([...this.state.configuredProviders, provider])),
      verifiedProviders: verified
        ? Array.from(new Set([...this.state.verifiedProviders, provider]))
        : this.state.verifiedProviders.filter((item) => item !== provider),
    })
  }

  prepareFirstTask(): void {
    this.isOpen = false
    this.update({
      firstTaskPrepared: true,
      completedStepIds: Array.from(new Set([
        ...this.state.completedStepIds,
        'first-task',
      ])),
    })
  }

  markGenerationCompleted(): void {
    if (this.state.status !== 'in_progress' || !this.state.firstTaskPrepared) return
    this.state = { ...this.state, firstTaskCompleted: true }
    this.complete()
  }

  markHintShown(hintId: string): void {
    const normalized = hintId.trim()
    if (!normalized || this.state.shownHintIds.includes(normalized)) return
    this.update({ shownHintIds: [...this.state.shownHintIds, normalized] })
  }

  private update(patch: Partial<OnboardingStateV2>): void {
    this.state = { ...this.state, ...patch, version: ONBOARDING_STATE_VERSION }
    this.commit()
  }

  private commit(): void {
    this.persist()
    this.publish()
  }

  private persist(): void {
    this.storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(this.state))
  }

  private publish(): void {
    this.snapshot = this.createSnapshot()
    this.listeners.forEach((listener) => listener())
  }

  private createSnapshot(): OnboardingSnapshot {
    return {
      ...this.state,
      primaryProvider: this.defaultsManager.getSnapshot().providerId,
      isOpen: this.isOpen,
    }
  }
}

export const onboardingManager = new OnboardingManager(browserStorage())

subscribeApplicationEvent('provider-key-configured', ({ providerId }) => {
  onboardingManager.markProviderConfigured(providerId)
})

subscribeApplicationEvent('provider-key-removed', ({ providerId }) => {
  onboardingManager.markProviderRemoved(providerId)
})

subscribeApplicationEvent('provider-connection-tested', ({ providerId, verified }) => {
  onboardingManager.markProviderConnection(providerId, verified)
})

subscribeApplicationEvent('generation-completed', () => {
  onboardingManager.markGenerationCompleted()
})
