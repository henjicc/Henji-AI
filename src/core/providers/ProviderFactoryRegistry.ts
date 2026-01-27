import type { ProviderId } from '@/core/types'
import type { ProviderHandler } from '@/core/providers/base'
import { PPIOProvider } from '@/core/providers/PPIOProvider'
import { FalProvider } from '@/core/providers/FalProvider'
import { KIEProvider } from '@/core/providers/KIEProvider'
import { ModelscopeProvider } from '@/core/providers/ModelscopeProvider'

export type ProviderFactory = (apiKey: string) => ProviderHandler

export interface RegisterProviderFactoryOptions {
  /** Whether overwriting an existing factory is allowed. Defaults to false. */
  overwrite?: boolean
}

/**
 * Central registry for provider factories.
 *
 * This avoids hard-coded `switch(provider)` logic in services and makes it easy
 * to add providers via registration.
 */
export class ProviderFactoryRegistry {
  private factories = new Map<ProviderId, ProviderFactory>()

  constructor() {
    // Built-in providers
    this.register('ppio', (apiKey) => new PPIOProvider(apiKey), { overwrite: true })
    this.register('fal', (apiKey) => new FalProvider(apiKey), { overwrite: true })
    this.register('kie', (apiKey) => new KIEProvider(apiKey), { overwrite: true })
    this.register('modelscope', (apiKey) => new ModelscopeProvider(apiKey), { overwrite: true })
  }

  register(
    providerId: ProviderId,
    factory: ProviderFactory,
    options: RegisterProviderFactoryOptions = {}
  ): void {
    const overwrite = options.overwrite === true
    if (this.factories.has(providerId) && !overwrite) {
      throw new Error(`[ProviderFactoryRegistry] Factory already registered: ${String(providerId)}`)
    }
    this.factories.set(providerId, factory)
  }

  has(providerId: ProviderId): boolean {
    return this.factories.has(providerId)
  }

  listProviderIds(): ProviderId[] {
    return Array.from(this.factories.keys())
  }

  create(providerId: ProviderId, apiKey: string): ProviderHandler {
    const factory = this.factories.get(providerId)
    if (!factory) {
      throw new Error(`[ProviderFactoryRegistry] Unsupported provider: ${String(providerId)}`)
    }
    return factory(apiKey)
  }
}

export const providerFactoryRegistry = new ProviderFactoryRegistry()

