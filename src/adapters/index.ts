import { MediaGeneratorAdapter } from './base/BaseAdapter'
import { PiaoYunAdapter } from './PiaoYunAdapter'

export type AdapterType = 'piaoyun' | 'openai' | 'stability' | 'midjourney'

export interface AdapterConfig {
  type: AdapterType
  apiKey: string
  modelName: string
}

export class AdapterFactory {
  static createAdapter(config: AdapterConfig): MediaGeneratorAdapter {
    switch (config.type) {
      case 'piaoyun':
        return new PiaoYunAdapter(config.apiKey)
      default:
        throw new Error(`Unsupported adapter type: ${config.type}`)
    }
  }
}