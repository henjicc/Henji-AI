/**
 * 配置索引 - 导出并注册所有模型配置
 */

import { optionsBuilder } from '../core/OptionsBuilder'

// PPIO 视频模型
import {
  seedanceV1Config,
  seedanceV1LiteConfig,
  seedanceV1ProConfig,
  viduQ1Config,
  kling25TurboConfig,
  minimaxHailuo23Config,
  pixverseV45Config,
  wan25PreviewConfig,
  seedream40Config
} from './ppio-video'

// Fal 模型
import {
  nanoBananaConfig,
  nanoBananaProConfig,
  falVeo31Config,
  falSeedreamV4Config,
  falSeedanceV1Config,
  falZImageTurboConfig,
  falKlingImageO1Config,
  falKlingVideoO1Config,
  falKlingV26ProConfig,
  falSora2Config,
  falLtx2Config,
  falViduQ2Config,
  falPixverseV55Config,
  falWan25Config
} from './fal-models'

// 魔搭和音频模型
import {
  modelscopeCommonConfig,
  modelscopeZImageTurboConfig,
  qwenImageEdit2509Config,
  modelscopeCustomConfig,
  minimaxSpeech26Config
} from './modelscope-audio'

/**
 * 注册所有模型配置
 */
export function registerAllConfigs() {
  // PPIO 视频模型
  optionsBuilder.registerConfig(seedanceV1Config)
  optionsBuilder.registerConfig(seedanceV1LiteConfig)
  optionsBuilder.registerConfig(seedanceV1ProConfig)
  optionsBuilder.registerConfig(viduQ1Config)
  optionsBuilder.registerConfig(kling25TurboConfig)
  optionsBuilder.registerConfig(minimaxHailuo23Config)
  optionsBuilder.registerConfig(pixverseV45Config)
  optionsBuilder.registerConfig(wan25PreviewConfig)
  optionsBuilder.registerConfig(seedream40Config)

  // Fal 图片模型
  optionsBuilder.registerConfig(nanoBananaConfig)
  optionsBuilder.registerConfig(nanoBananaProConfig)
  optionsBuilder.registerConfig(falZImageTurboConfig)
  optionsBuilder.registerConfig(falKlingImageO1Config)

  // Fal 视频模型
  optionsBuilder.registerConfig(falVeo31Config)
  optionsBuilder.registerConfig(falSeedreamV4Config)
  optionsBuilder.registerConfig(falSeedanceV1Config)
  optionsBuilder.registerConfig(falKlingVideoO1Config)
  optionsBuilder.registerConfig(falKlingV26ProConfig)
  optionsBuilder.registerConfig(falSora2Config)
  optionsBuilder.registerConfig(falLtx2Config)
  optionsBuilder.registerConfig(falViduQ2Config)
  optionsBuilder.registerConfig(falPixverseV55Config)
  optionsBuilder.registerConfig(falWan25Config)

  // 魔搭图片模型
  optionsBuilder.registerConfig(modelscopeCommonConfig)
  optionsBuilder.registerConfig(modelscopeZImageTurboConfig)
  optionsBuilder.registerConfig(qwenImageEdit2509Config)
  optionsBuilder.registerConfig(modelscopeCustomConfig)

  // 音频模型
  optionsBuilder.registerConfig(minimaxSpeech26Config)

  // 为支持多个 ID 的模型注册别名
  registerAliases()
}

/**
 * 注册模型别名
 */
function registerAliases() {
  // Fal 模型别名
  optionsBuilder.registerConfig({ ...nanoBananaConfig, id: 'fal-ai-nano-banana' })
  optionsBuilder.registerConfig({ ...nanoBananaProConfig, id: 'fal-ai-nano-banana-pro' })
  optionsBuilder.registerConfig({ ...falVeo31Config, id: 'fal-ai-veo-3.1' })
  optionsBuilder.registerConfig({ ...falSeedreamV4Config, id: 'fal-ai-bytedance-seedream-v4' })
  optionsBuilder.registerConfig({ ...falSeedreamV4Config, id: 'bytedance-seedream-v4.5' })
  optionsBuilder.registerConfig({ ...falSeedreamV4Config, id: 'fal-ai-bytedance-seedream-v4.5' })
  optionsBuilder.registerConfig({ ...falSeedanceV1Config, id: 'fal-ai-bytedance-seedance-v1' })
  optionsBuilder.registerConfig({ ...falKlingImageO1Config, id: 'kling-o1' })
  optionsBuilder.registerConfig({ ...falKlingVideoO1Config, id: 'fal-ai-kling-video-o1' })
  optionsBuilder.registerConfig({ ...falKlingV26ProConfig, id: 'fal-ai-kling-video-v2.6-pro' })
  optionsBuilder.registerConfig({ ...falSora2Config, id: 'fal-ai-sora-2' })
  optionsBuilder.registerConfig({ ...falLtx2Config, id: 'fal-ai-ltx-2' })
  optionsBuilder.registerConfig({ ...falViduQ2Config, id: 'fal-ai-vidu-q2' })
  optionsBuilder.registerConfig({ ...falPixverseV55Config, id: 'fal-ai-pixverse-v5.5' })
  optionsBuilder.registerConfig({ ...falWan25Config, id: 'fal-ai-wan-25-preview' })

  // 魔搭模型别名 - 为每个具体模型 ID 注册配置
  const modelscopeModels = [
    'Qwen/Qwen-Image',
    'black-forest-labs/FLUX.1-Krea-dev',
    'MusePublic/14_ckpt_SD_XL',
    'MusePublic/majicMIX_realistic'
  ]

  modelscopeModels.forEach(modelId => {
    optionsBuilder.registerConfig({ ...modelscopeCommonConfig, id: modelId })
  })
}

// 导出 optionsBuilder 实例
export { optionsBuilder }
