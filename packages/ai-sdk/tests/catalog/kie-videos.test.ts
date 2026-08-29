import { describe, expect, it } from 'vitest'

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { kiePresentation } from '@/models/presentation/kie'
import { catalogIndex, type JsonObject, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'
import { kieGeminiOmniVideoModel as kieGeminiOmniVideoRuntime } from '../../src/catalog/kie/gemini-omni-video.model'
import { kieHailuo02Model as kieHailuo02Runtime } from '../../src/catalog/kie/hailuo-02.model'
import { kieHailuo23Model as kieHailuo23Runtime } from '../../src/catalog/kie/hailuo-2-3.model'
import { kieKling30Model as kieKling30Runtime } from '../../src/catalog/kie/kling-3.0.model'
import { kieKling30OmniModel as kieKling30OmniRuntime } from '../../src/catalog/kie/kling-3.0-omni.model'
import { kieKling30TurboModel as kieKling30TurboRuntime } from '../../src/catalog/kie/kling-3.0-turbo.model'
import { kieMiniMaxH3Model as kieMiniMaxH3Runtime } from '../../src/catalog/kie/minimax-h3.model'
import { kieSeedance20Model as kieSeedance20Runtime } from '../../src/catalog/kie/seedance-2.0.model'
import { kieSeedance20FastModel as kieSeedance20FastRuntime } from '../../src/catalog/kie/seedance-2.0-fast.model'
import { kieSeedance20MiniModel as kieSeedance20MiniRuntime } from '../../src/catalog/kie/seedance-2.0-mini.model'
import { kieSeedance25Model as kieSeedance25Runtime } from '../../src/catalog/kie/seedance-2.5.model'

const compose = (runtime: ModelRuntimeDefinition) =>
  composeModelDefinition(runtime, kiePresentation[runtime.meta.id])

const kieGeminiOmniVideoModel = compose(kieGeminiOmniVideoRuntime)
const kieHailuo02Model = compose(kieHailuo02Runtime)
const kieHailuo23Model = compose(kieHailuo23Runtime)
const kieKling30Model = compose(kieKling30Runtime)
const kieKling30OmniModel = compose(kieKling30OmniRuntime)
const kieKling30TurboModel = compose(kieKling30TurboRuntime)
const kieMiniMaxH3Model = compose(kieMiniMaxH3Runtime)
const kieSeedance20Model = compose(kieSeedance20Runtime)
const kieSeedance20FastModel = compose(kieSeedance20FastRuntime)
const kieSeedance20MiniModel = compose(kieSeedance20MiniRuntime)
const kieSeedance25Model = compose(kieSeedance25Runtime)

function evaluateCatalogBuilder(modelId: string, params: JsonObject) {
  const model = catalogIndex.get(modelId)
  expect(model?.request?.builder).toBeTypeOf('function')
  return model!.request!.builder!(params)
}

describe('packages/ai-sdk/docs/model-adaptation KIE 视频模型', () => {
  const models = [
    kieGeminiOmniVideoModel,
    kieMiniMaxH3Model,
    kieKling30Model,
    kieKling30TurboModel,
    kieKling30OmniModel,
    kieSeedance20Model,
    kieSeedance20FastModel,
    kieSeedance20MiniModel,
    kieSeedance25Model,
  ]

  it.each(models)('$meta.id 在画布使用独立比例与分辨率参数', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each(models)('$meta.id 的 catalog builder 可直接执行', (model) => {
    expect(evaluateCatalogBuilder(model.meta.id, { prompt: 'test' })).toMatchObject({
      input: { prompt: 'test' }
    })
  })

  it('Gemini Omni 使用档案中的最新固定档价格', () => {
    expect(kieGeminiOmniVideoModel.pricing.calculator?.({
      kieGeminiOmniVideoDuration: '4',
      kieGeminiOmniVideoResolution: '720p'
    })).toBe(0.315)
    expect(kieGeminiOmniVideoModel.pricing.calculator?.({
      uploadedVideoFilePaths: ['video.mp4'],
      kieGeminiOmniVideoResolution: '4k'
    })).toBe(1.26)
  })

  it('Hailuo 02 文生 512P 按实际 768P 路由计价', () => {
    const textParams = {
      prompt: 'text',
      kieHailuo02Duration: 6,
      kieHailuo02Resolution: '512P'
    }
    expect(kieHailuo02Model.pricing.calculator?.(textParams)).toBeCloseTo(0.15)
    const textRequest = kieHailuo02Model.request?.builder?.(textParams)
    expect(textRequest).toMatchObject({
      model: 'hailuo/02-text-to-video-standard',
      input: { prompt: 'text', duration: '6' }
    })
    expect(textRequest?.input).not.toHaveProperty('resolution')

    const imageParams = { ...textParams, uploadedFilePaths: ['first.png'] }
    expect(kieHailuo02Model.pricing.calculator?.(imageParams)).toBeCloseTo(0.06)
    expect(kieHailuo02Model.request?.builder?.(imageParams)).toMatchObject({
      model: 'hailuo/02-image-to-video-standard',
      input: { image_url: 'first.png', resolution: '512P' }
    })
  })

  it('Hailuo 02 将非法 10s 1080P 回收到 10s 768P', () => {
    const params = {
      prompt: 'legacy',
      uploadedFilePaths: ['first.png'],
      kieHailuo02Duration: 10,
      kieHailuo02Resolution: '1080P'
    }
    expect(kieHailuo02Model.pricing.calculator?.(params)).toBe(0.25)
    expect(kieHailuo02Model.request?.builder?.(params)).toMatchObject({
      model: 'hailuo/02-image-to-video-standard',
      input: { duration: '10', resolution: '768P' }
    })
  })

  it('Hailuo 2.3 只按官方六个合法组合计价', () => {
    const cases = [
      ['standard', 6, '768P', 0.15],
      ['standard', 10, '768P', 0.25],
      ['standard', 6, '1080P', 0.25],
      ['pro', 6, '768P', 0.225],
      ['pro', 10, '768P', 0.45],
      ['pro', 6, '1080P', 0.4]
    ] as const
    for (const [mode, duration, resolution, price] of cases) {
      expect(kieHailuo23Model.pricing.calculator?.({
        kieHailuo23Mode: mode,
        kieHailuo23Duration: duration,
        kieHailuo23Resolution: resolution
      })).toBe(price)
    }
  })

  it('Hailuo 2.3 将 Standard/Pro 的非法 10s 1080P 回收到 768P', () => {
    for (const [mode, expectedPrice] of [['standard', 0.25], ['pro', 0.45]] as const) {
      const params = {
        prompt: mode,
        uploadedFilePaths: ['first.png'],
        kieHailuo23Mode: mode,
        kieHailuo23Duration: 10,
        kieHailuo23Resolution: '1080P'
      }
      expect(kieHailuo23Model.pricing.calculator?.(params)).toBe(expectedPrice)
      expect(kieHailuo23Model.request?.builder?.(params)).toMatchObject({
        input: { duration: '10', resolution: '768P' }
      })
    }
  })

  it('Seedance 2.0 Fast/Mini 使用是否带视频的最新秒价', () => {
    expect(kieSeedance20FastModel.pricing.calculator?.({
      kieSeedance20FastDuration: 5,
      kieSeedance20FastResolution: '720p'
    })).toBeCloseTo(0.62)
    expect(kieSeedance20FastModel.pricing.calculator?.({
      kieSeedance20FastMode: 'reference-to-video',
      uploadedVideoFilePaths: ['video.mp4'],
      kieSeedance20FastDuration: 5,
      kieSeedance20FastResolution: '720p'
    })).toBeCloseTo(0.375)
    expect(kieSeedance20MiniModel.pricing.calculator?.({
      kieSeedance20MiniMode: 'reference-to-video',
      uploadedVideoFilePaths: ['video.mp4'],
      kieSeedance20MiniDuration: 5,
      kieSeedance20MiniResolution: '480p'
    })).toBeCloseTo(0.06)
  })

  it('MiniMax H3 自动选择文生、首尾帧和多模态参考端点', () => {
    expect(kieMiniMaxH3Model.request?.builder?.({ prompt: 'text' })).toMatchObject({
      model: 'minimax-h3/text-to-video',
      input: { aspect_ratio: '16:9', resolution: '2K', duration: 6 }
    })
    expect(kieMiniMaxH3Model.request?.builder?.({
      prompt: 'frames',
      uploadedFilePaths: ['first.png', 'last.png']
    })).toMatchObject({
      model: 'minimax-h3/image-to-video',
      input: { first_frame_image: 'first.png', last_frame_image: 'last.png' }
    })
    expect(kieMiniMaxH3Model.request?.builder?.({
      prompt: 'reference',
      kieMiniMaxH3Mode: 'reference-to-video',
      uploadedFilePaths: ['character.png'],
      uploadedVideoFilePaths: ['motion.mp4'],
      uploadedAudioFilePaths: ['voice.mp3']
    })).toMatchObject({
      model: 'minimax-h3/reference-to-video',
      input: {
        reference_image_urls: ['character.png'],
        reference_video_urls: ['motion.mp4'],
        reference_audio_urls: ['voice.mp3'],
        aspect_ratio: 'adaptive'
      }
    })
  })

  it('Kling 3.0 将展示分辨率映射为 KIE mode', () => {
    expect(kieKling30Model.request?.builder?.({
      prompt: 'scene',
      uploadedFilePaths: ['first.png', 'last.png'],
      kieKling30Resolution: '4K',
      kieKling30AspectRatio: 'smart',
      __firstImageRatio: 9 / 16
    })).toMatchObject({
      model: 'kling-3.0/video',
      input: {
        image_urls: ['first.png', 'last.png'],
        aspect_ratio: '9:16',
        mode: '4K',
        multi_shots: false
      }
    })
  })

  it('Kling 3.0 Turbo 按图片存在切换 KIE 模型 ID', () => {
    expect(kieKling30TurboModel.request?.builder?.({ prompt: 'text' })).toMatchObject({
      model: 'kling/v3-turbo-text-to-video',
      input: { aspect_ratio: '16:9', resolution: '720p' }
    })
    expect(kieKling30TurboModel.request?.builder?.({
      prompt: 'image',
      uploadedFilePaths: ['first.png'],
      kieKling30TurboResolution: '1080p'
    })).toMatchObject({
      model: 'kling/v3-turbo-image-to-video',
      input: { image_urls: ['first.png'], resolution: '1080p' }
    })
  })

  it('Kling 3.0 Omni 覆盖文生、图生、变换和参考四条路由', () => {
    const cases = [
      ['text-to-video', 'kling-3.0-omni/text-to-video'],
      ['image-to-video', 'kling-3.0-omni/image-to-video'],
      ['transformation', 'kling-3.0-omni/transformation'],
      ['reference-to-video', 'kling-3.0-omni/reference-to-video'],
    ] as const
    for (const [mode, expectedModel] of cases) {
      expect(kieKling30OmniModel.request?.builder?.({
        prompt: mode,
        kieKling30OmniMode: mode,
        uploadedFilePaths: ['image.png'],
        uploadedVideoFilePaths: ['video.mp4']
      })).toMatchObject({ model: expectedModel })
    }
    expect(kieKling30OmniModel.request?.builder?.({
      prompt: 'image',
      kieKling30OmniMode: 'image-to-video',
      uploadedFilePaths: ['image.png'],
      kieKling30OmniDuration: '7'
    })).toMatchObject({ input: { aspect_ratio: 'auto', duration: 7 } })
  })

  it('Gemini Omni 传递音频/角色资产并校验共享图片槽位', () => {
    expect(kieGeminiOmniVideoModel.request?.builder?.({
      prompt: 'character',
      images: ['a.png', 'b.png'],
      kieGeminiOmniVideoAudioIds: 'voice-1\nvoice-2',
      kieGeminiOmniVideoCharacterIds: 'character-1, character-2'
    })).toMatchObject({
      input: {
        image_urls: ['a.png', 'b.png'],
        audio_ids: ['voice-1', 'voice-2'],
        character_ids: ['character-1', 'character-2']
      }
    })
    expect(() => kieGeminiOmniVideoModel.request?.builder?.({
      prompt: 'too many slots',
      images: Array.from({ length: 6 }, (_, index) => `${index}.png`),
      kieGeminiOmniVideoCharacterIds: 'character-1\ncharacter-2'
    })).toThrow(/7/)
  })

  it('Seedance 2.5 支持 30/10/10 参考输入上限并按视频输入计价', () => {
    expect(kieSeedance25Model.inputLimits).toMatchObject({
      rules: [{ images: { max: 30 }, videos: { max: 10 }, audios: { max: 10 } }]
    })
    expect(kieSeedance25Model.pricing.calculator?.({
      kieSeedance25Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['video.mp4'],
      kieSeedance25Duration: 10,
      kieSeedance25Resolution: '1080p'
    })).toBeCloseTo(3.425)
  })

  it('Seedance 2.0 默认 16:9 并可返回尾帧', () => {
    expect(kieSeedance20Model.request?.builder?.({
      prompt: 'continue',
      kieSeedance20ReturnLastFrame: true
    })).toMatchObject({
      input: { aspect_ratio: '16:9', return_last_frame: true }
    })
    expect(kieSeedance20FastModel.request?.builder?.({
      prompt: 'continue',
      kieSeedance20FastReturnLastFrame: true
    })).toMatchObject({
      input: { aspect_ratio: '16:9', return_last_frame: true }
    })
  })

  it('Seedance 2.5 支持 adaptive、-1 自动时长和字符串联网搜索开关', () => {
    expect(kieSeedance25Model.request?.builder?.({
      prompt: 'search and animate',
      kieSeedance25AutoDuration: true,
      kieSeedance25WebSearch: true
    })).toMatchObject({
      input: {
        aspect_ratio: 'adaptive',
        duration: -1,
        web_search: 'true',
        nsfw_checker: true
      }
    })
  })

  it('Seedance 2.5 视频参考计价包含输入时长', () => {
    expect(kieSeedance25Model.pricing.calculator?.({
      kieSeedance25Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['video.mp4'],
      __firstVideoDurationSeconds: 6,
      kieSeedance25Duration: 10,
      kieSeedance25Resolution: '1080p'
    })).toBeCloseTo(5.48)
  })
})
