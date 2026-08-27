import { describe, expect, it } from 'vitest'

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { composeModelDefinition } from '@/core/composeModelDefinition'
import { falPresentation } from '@/models/presentation/fal'
import { catalogIndex, type JsonObject, type ModelRuntimeDefinition } from '@henjicc/ai-sdk'
import { falGeminiOmniFlashModel as falGeminiOmniFlashRuntime } from '../../src/catalog/fal/gemini-omni-flash.model'
import { falGptImage2Model as falGptImage2Runtime } from '../../src/catalog/fal/gpt-image-2.model'
import { falGrokImagine20Model as falGrokImagine20Runtime } from '../../src/catalog/fal/grok-imagine-2.0.model'
import { falKling30Model as falKling30Runtime } from '../../src/catalog/fal/kling-3.0.model'
import { falKling30TurboModel as falKling30TurboRuntime } from '../../src/catalog/fal/kling-3.0-turbo.model'
import { falKling30OmniModel as falKling30OmniRuntime } from '../../src/catalog/fal/kling-3.0-omni.model'
import { falMiniMaxH3Model as falMiniMaxH3Runtime } from '../../src/catalog/fal/minimax-h3.model'
import { falNanoBanana2Model as falNanoBanana2Runtime } from '../../src/catalog/fal/nano-banana-2.model'
import { nanoBananaProModel as nanoBananaProRuntime } from '../../src/catalog/fal/nano-banana-pro.model'
import { falQwenImage30Model as falQwenImage30Runtime } from '../../src/catalog/fal/qwen-image-3.0.model'
import { falSeedance20Model as falSeedance20Runtime } from '../../src/catalog/fal/seedance-2.0.model'
import { falSeedance20FastModel as falSeedance20FastRuntime } from '../../src/catalog/fal/seedance-2.0-fast.model'
import { falSeedance20MiniModel as falSeedance20MiniRuntime } from '../../src/catalog/fal/seedance-2.0-mini.model'
import { falSeedance25Model as falSeedance25Runtime } from '../../src/catalog/fal/seedance-2.5.model'
import { falSeedream50LiteModel as falSeedream50LiteRuntime } from '../../src/catalog/fal/seedream-5.0-lite.model'
import { falSeedream50ProModel as falSeedream50ProRuntime } from '../../src/catalog/fal/seedream-5.0-pro.model'
import { zImageTurboModel as zImageTurboRuntime } from '../../src/catalog/fal/z-image-turbo.model'

const compose = (runtime: ModelRuntimeDefinition) =>
  composeModelDefinition(runtime, falPresentation[runtime.meta.id])

const falGeminiOmniFlashModel = compose(falGeminiOmniFlashRuntime)
const falGptImage2Model = compose(falGptImage2Runtime)
const falGrokImagine20Model = compose(falGrokImagine20Runtime)
const falKling30Model = compose(falKling30Runtime)
const falKling30TurboModel = compose(falKling30TurboRuntime)
const falKling30OmniModel = compose(falKling30OmniRuntime)
const falMiniMaxH3Model = compose(falMiniMaxH3Runtime)
const falNanoBanana2Model = compose(falNanoBanana2Runtime)
const nanoBananaProModel = compose(nanoBananaProRuntime)
const falQwenImage30Model = compose(falQwenImage30Runtime)
const falSeedance20Model = compose(falSeedance20Runtime)
const falSeedance20FastModel = compose(falSeedance20FastRuntime)
const falSeedance20MiniModel = compose(falSeedance20MiniRuntime)
const falSeedance25Model = compose(falSeedance25Runtime)
const falSeedream50LiteModel = compose(falSeedream50LiteRuntime)
const falSeedream50ProModel = compose(falSeedream50ProRuntime)
const zImageTurboModel = compose(zImageTurboRuntime)

const imageModels = [
  falGptImage2Model,
  falGrokImagine20Model,
  falNanoBanana2Model,
  nanoBananaProModel,
  falQwenImage30Model,
  falSeedream50LiteModel,
  falSeedream50ProModel,
  zImageTurboModel,
]

const videoModels = [
  falGeminiOmniFlashModel,
  falKling30Model,
  falKling30TurboModel,
  falKling30OmniModel,
  falMiniMaxH3Model,
  falSeedance20Model,
  falSeedance20FastModel,
  falSeedance20MiniModel,
  falSeedance25Model,
]

function evaluateCatalogBuilder(modelId: string, params: JsonObject) {
  const model = catalogIndex.get(modelId)
  expect(model?.request?.builder).toBeTypeOf('function')
  return model!.request!.builder!(params)
}

describe('packages/ai-sdk/docs/model-adaptation Fal 目标模型', () => {
  it.each([...imageModels, ...videoModels])('$meta.id 在画布使用独立比例与分辨率参数', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each([...imageModels, ...videoModels])('$meta.id 的 catalog builder 可直接执行', (model) => {
    const params: JsonObject = model.meta.id === 'fal-ai-gemini-omni-flash'
      ? { prompt: 'test', images: ['input.png'] }
      : { prompt: 'test' }
    expect(evaluateCatalogBuilder(model.meta.id, params)).toMatchObject({ prompt: 'test' })
  })

  it.each(imageModels)('$meta.id 不展示也不发送 output_format', (model) => {
    expect(model.params.some((param) => /output.?format/i.test(param.id))).toBe(false)
    expect(model.request?.builder?.({ prompt: 'test' })).not.toHaveProperty('output_format')
  })

  it('GPT Image 2、Nano Banana Pro 与 Z-Image 使用官方价格和路由', async () => {
    expect(await (falGptImage2Model.endpoints as { selector: (params: JsonObject) => Promise<string> }).selector({ images: ['a.png'] }))
      .toBe('openai/gpt-image-2/edit')
    expect(nanoBananaProModel.pricing.calculator?.({ falNanoBananaProResolution: '4K' })).toBe(0.3)
    expect(zImageTurboModel.pricing.description).toContain('$0.005/百万像素')
    expect(zImageTurboModel.request?.builder?.({ prompt: 'edit', images: ['a.png'] })).toMatchObject({
      image_url: 'a.png', strength: 0.6
    })
  })

  it('Kling 三个型号按档位与媒体切换 Fal 官方端点', async () => {
    const standard = falKling30Model.endpoints as { selector: (params: JsonObject) => Promise<string> }
    const turbo = falKling30TurboModel.endpoints as { selector: (params: JsonObject) => Promise<string> }
    const omni = falKling30OmniModel.endpoints as { selector: (params: JsonObject) => Promise<string> }
    expect(await standard.selector({ falKling30Resolution: 'pro', images: ['a.png'] }))
      .toBe('fal-ai/kling-video/v3/pro/image-to-video')
    expect(await turbo.selector({ falKling30TurboResolution: 'standard' }))
      .toBe('fal-ai/kling-video/v3/turbo/standard/text-to-video')
    expect(await omni.selector({ falKling30OmniResolution: 'pro', falKling30OmniMode: 'reference-to-video' }))
      .toBe('fal-ai/kling-video/o3/pro/reference-to-video')
  })

  it('MiniMax 与 Seedance 覆盖首尾帧和多模态参考字段', () => {
    expect(falMiniMaxH3Model.request?.builder?.({
      prompt: 'reference', falMiniMaxH3Mode: 'reference-to-video',
      images: ['a.png'], videos: ['v.mp4'], audios: ['voice.mp3']
    })).toMatchObject({
      reference_image_urls: ['a.png'], reference_video_urls: ['v.mp4'], reference_audio_urls: ['voice.mp3'],
      prompt_expansion_mode: 'balanced'
    })
    expect(falSeedance25Model.request?.builder?.({
      prompt: 'frames', images: ['first.png', 'last.png']
    })).toMatchObject({ image_url: 'first.png', end_image_url: 'last.png' })
  })

  it('Fal Seedance 校验 2.0 参考素材依赖并支持 2.5 自动时长', () => {
    expect(() => falSeedance20Model.request?.builder?.({
      prompt: 'audio only',
      falSeedance20Mode: 'reference-to-video',
      audios: ['voice.mp3']
    })).toThrow(/must|reference|\u5fc5须|\u53c2考/u)
    expect(() => falSeedance20FastModel.request?.builder?.({
      prompt: 'too many',
      falSeedance20FastMode: 'reference-to-video',
      images: Array.from({ length: 9 }, (_, index) => `image-${index}.png`),
      videos: ['a.mp4', 'b.mp4', 'c.mp4'],
      audios: ['voice.mp3']
    })).toThrow(/12/)
    expect(falSeedance25Model.request?.builder?.({
      prompt: 'automatic',
      falSeedance25AutoDuration: true
    })).toMatchObject({ duration: 'auto' })
  })

  it('Fal Seedance 有视频参考时按折扣费率与总时长计价', () => {
    expect(falSeedance20Model.pricing.calculator?.({
      falSeedance20Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['source.mp4'],
      __firstVideoDurationSeconds: 10,
      falSeedance20Duration: 5,
      falSeedance20Resolution: '720p'
    })).toBeCloseTo(2.7306)
    expect(falSeedance25Model.pricing.calculator?.({
      falSeedance25Mode: 'reference-to-video',
      uploadedVideoFilePaths: ['source.mp4'],
      __firstVideoDurationSeconds: 10,
      falSeedance25Duration: 5,
      falSeedance25Resolution: '720p'
    })).toBeCloseTo(4.257)
  })

  it('Nano Banana 2 的 PDF 上下文会切换编辑端点并下发 pdf_url', async () => {
    const endpoints = falNanoBanana2Model.endpoints as { selector: (params: JsonObject) => Promise<string> }
    expect(await endpoints.selector({ falNanoBanana2PdfUrl: ['https://example.com/context.pdf'] }))
      .toBe('fal-ai/nano-banana-2/edit')
    expect(falNanoBanana2Model.request?.builder?.({
      prompt: 'read context', falNanoBanana2PdfUrl: ['https://example.com/context.pdf']
    })).toMatchObject({ pdf_url: 'https://example.com/context.pdf' })
  })

  it('Fal Seedream Pro/Lite 保留旧默认并可显式选择插件 1MP 请求语义', () => {
    expect(falSeedream50ProModel.request?.builder?.({ prompt: 'default' }))
      .toMatchObject({ image_size: 'auto_2K', num_images: 1, enable_safety_checker: true })
    expect(falSeedream50LiteModel.request?.builder?.({ prompt: 'default' }))
      .toMatchObject({ image_size: 'auto_2K', num_images: 1, max_images: 1, enable_safety_checker: true })
    expect(falSeedream50ProModel.request?.builder?.({
      prompt: 'wide', falSeedream50ProAspectRatio: '21:9', falSeedream50ProResolution: '1MP'
    })).toMatchObject({ image_size: { width: 1568, height: 672 } })
    expect(falSeedream50LiteModel.request?.builder?.({
      prompt: 'portrait', falSeedream50LiteAspectRatio: '4:5', falSeedream50LiteResolution: '1MP'
    })).toMatchObject({ image_size: { width: 928, height: 1152 } })
  })

  it('Fal Qwen Image 3 兼容 COMMON10、1MP 与编辑端省略尺寸', async () => {
    const endpoints = falQwenImage30Model.endpoints as { selector: (params: JsonObject) => Promise<string> }
    expect(await endpoints.selector({ images: ['input.png'] })).toBe('alibaba/qwen-image-3/edit')
    expect(falQwenImage30Model.request?.builder?.({
      prompt: 'text', falQwenImage30AspectRatio: '16:9',
      falQwenImage30Resolution: '1MP', falQwenImage30PromptExpansion: false
    })).toMatchObject({
      image_size: { width: 1376, height: 768 }, enable_prompt_expansion: false
    })
    const edit = falQwenImage30Model.request?.builder?.({
      prompt: 'edit', images: ['input.png'], falQwenImage30AspectRatio: '4:5',
      falQwenImage30Resolution: '1MP', falQwenImage30PromptExpansion: false
    })
    expect(edit).toMatchObject({ image_urls: ['input.png'], enable_prompt_expansion: false })
    expect(edit).not.toHaveProperty('image_size')
  })

  it('Fal GPT Image 2 与 Z-Image 显式 1MP 分支不改变旧默认', () => {
    expect(falGptImage2Model.request?.builder?.({ prompt: 'default' }))
      .toMatchObject({ image_size: 'square_hd', quality: 'high', num_images: 1 })
    expect(falGptImage2Model.request?.builder?.({
      prompt: 'plugin', falGptImage2AspectRatio: '21:9',
      falGptImage2ImageSize: '1MP', falGptImage2Resolution: 'auto'
    })).toMatchObject({ image_size: { width: 1568, height: 672 }, quality: 'auto' })
    expect(zImageTurboModel.request?.builder?.({ prompt: 'default' }))
      .toMatchObject({ image_size: { width: 1024, height: 1024 } })
    expect(zImageTurboModel.request?.builder?.({
      prompt: 'plugin', falZImageTurboAspectRatio: '16:9', falZImageTurboImageSize: '1MP'
    })).toMatchObject({ image_size: { width: 1376, height: 768 } })
  })

  it('Fal Nano Banana 隐藏默认与官方 schema 一致', () => {
    expect(falNanoBanana2Model.request?.builder?.({ prompt: 'default' })).toMatchObject({
      num_images: 1, limit_generations: true, enable_web_search: false
    })
    expect(nanoBananaProModel.request?.builder?.({ prompt: 'default' })).toMatchObject({
      num_images: 1, limit_generations: true, enable_web_search: false
    })
  })
})
