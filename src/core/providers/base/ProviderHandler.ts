/**
 * Legacy compatibility shell for old frontend providers.
 *
 * Generation is now executed by the Electron backend runtime. This class is retained
 * only to avoid breaking old imports during migration.
 */

import type { ModelDefinition } from '@/core/types'
import type { GenerateResult } from './types'

export abstract class ProviderHandler {
  protected readonly providerName: string

  protected constructor(providerName: string) {
    this.providerName = providerName
  }

  async generate(_model: ModelDefinition, _params: DynamicValueMap): Promise<GenerateResult> {
    throw new Error(`[${this.providerName}] Frontend provider execution is deprecated`) 
  }
}
