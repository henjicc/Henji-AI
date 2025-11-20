import { MediaGeneratorAdapter } from './base/BaseAdapter'
import { PPIOAdapter } from './PPIOAdapter'
import { FalAdapter } from './FalAdapter'

export type AdapterType = 'piaoyun' | 'fal' | 'openai' | 'stability' | 'midjourney'

export interface AdapterConfig {
  type: AdapterType
  apiKey: string
  modelName: string
}

export class AdapterFactory {
  static createAdapter(config: AdapterConfig): MediaGeneratorAdapter {
    switch (config.type) {
      case 'piaoyun':
        return new PPIOAdapter(config.apiKey)
      case 'fal':
        return new FalAdapter(config.apiKey)
      default:
        throw new Error(`Unsupported adapter type: ${config.type}`)
    }
  }
}