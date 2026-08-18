import type { ProviderId } from '@/core/types'

export type ProviderFactory = never

export interface RegisterProviderFactoryOptions {
  overwrite?: boolean
}

const BUILTIN_PROVIDER_IDS: ProviderId[] = ['ppio', 'fal', 'kie', 'modelscope']

/**
 * ProviderFactoryRegistry is kept for compatibility.
 *
 * In backend runtime mode, all provider execution is handled by Electron `ai-runtime`.
 */
export class ProviderFactoryRegistry {
  private readonly providerIds = new Set<ProviderId>(BUILTIN_PROVIDER_IDS)

  register(
    providerId: ProviderId,
    _factory: ProviderFactory,
    _options: RegisterProviderFactoryOptions = {}
  ): void {
    this.providerIds.add(providerId)
  }

  has(providerId: ProviderId): boolean {
    return this.providerIds.has(providerId)
  }

  listProviderIds(): ProviderId[] {
    return Array.from(this.providerIds)
  }

  create(_providerId: ProviderId, _apiKey: string): never {
    throw new Error('[ProviderFactoryRegistry] create() is unavailable in backend runtime mode')
  }
}

export const providerFactoryRegistry = new ProviderFactoryRegistry()
