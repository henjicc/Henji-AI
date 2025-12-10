import { MediaGeneratorAdapter } from './base/BaseAdapter'
import { PPIOAdapter } from './ppio/PPIOAdapter'
import { FalAdapter } from './fal/FalAdapter'
import { ModelscopeAdapter } from './modelscope/ModelscopeAdapter'
import { KIEAdapter } from './kie/KIEAdapter'

export type AdapterType = 'piaoyun' | 'fal' | 'modelscope' | 'kie' | 'openai' | 'stability' | 'midjourney'

export interface AdapterConfig {
  type: AdapterType
  apiKey: string
  modelName: string
  falApiKey?: string  // 用于文件上传（魔搭等需要 URL 的适配器）
}

export class AdapterFactory {
  static createAdapter(config: AdapterConfig): MediaGeneratorAdapter {
    switch (config.type) {
      case 'piaoyun':
        return new PPIOAdapter(config.apiKey)
      case 'fal':
        return new FalAdapter(config.apiKey)
      case 'modelscope':
        return new ModelscopeAdapter(config.apiKey, config.falApiKey)
      case 'kie':
        return new KIEAdapter(config.apiKey)
      default:
        throw new Error(`Unsupported adapter type: ${config.type}`)
    }
  }
}