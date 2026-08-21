import { describe, expect, it, vi } from 'vitest'

vi.mock('@/core', async () => {
  const [{ defineModel }, modelText] = await Promise.all([
    import('@/core/defineModel'),
    import('@/core/i18n/modelText'),
  ])
  return { defineModel, ...modelText }
})

import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import { evalFunction } from '../../../electron/main/services/ai-runtime/js-runtime'
import type { JsonObject } from '../../../electron/main/services/ai-runtime/types'
import modelManifest from '../../../resources/model-manifest.json'
import { falGeminiOmniFlashModel } from './gemini-omni-flash.model'
import { falGptImage2Model } from './gpt-image-2.model'
import { falGrokImagine20Model } from './grok-imagine-2.0.model'
import { falKling30Model } from './kling-3.0.model'
import { falKling30TurboModel } from './kling-3.0-turbo.model'
import { falKling30OmniModel } from './kling-3.0-omni.model'
import { falMiniMaxH3Model } from './minimax-h3.model'
import { falNanoBanana2Model } from './nano-banana-2.model'
import { nanoBananaProModel } from './nano-banana-pro.model'
import { falQwenImage30Model } from './qwen-image-3.0.model'
import { falSeedance20Model } from './seedance-2.0.model'
import { falSeedance20FastModel } from './seedance-2.0-fast.model'
import { falSeedance20MiniModel } from './seedance-2.0-mini.model'
import { falSeedance25Model } from './seedance-2.5.model'
import { falSeedream50LiteModel } from './seedream-5.0-lite.model'
import { falSeedream50ProModel } from './seedream-5.0-pro.model'
import { zImageTurboModel } from './z-image-turbo.model'

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

function evaluateManifestBuilder(modelId: string, params: JsonObject) {
  const model = modelManifest.models.find((item) => item.modelId === modelId)
  expect(model?.request?.builderJs).toBeTruthy()
  return evalFunction(model!.request!.builderJs!, params)
}

describe('docs/model-adaptation Fal 目标模型', () => {
  it.each([...imageModels, ...videoModels])('$meta.id 在画布使用独立比例与分辨率参数', (model) => {
    expect(model.params.some((param) => param.type === 'composite')).toBe(false)
    const spec = analyzeRatioResolutionParams(model.params, [])
    expect(spec?.aspectParam?.id).toBeTruthy()
    expect(spec?.resolutionParam?.id).toBeTruthy()
    expect(spec?.aspectParam?.id).not.toBe(spec?.resolutionParam?.id)
  })

  it.each([...imageModels, ...videoModels])('$meta.id 的 manifest builder 可在独立 VM 执行', (model) => {
    const params: JsonObject = model.meta.id === 'fal-ai-gemini-omni-flash'
      ? { prompt: 'test', images: ['input.png'] }
      : { prompt: 'test' }
    expect(evaluateManifestBuilder(model.meta.id, params)).toMatchObject({ prompt: 'test' })
  })

  it.each(imageModels)('$meta.id 不展示也不发送 output_format', (model) => {
    expect(model.params.some((param) => /output.?format/i.test(param.id))).toBe(false)
    expect(model.request?.builder?.({ prompt: 'test' })).not.toHaveProperty('output_format')
  })

  it('GPT Image 2、Nano Banana Pro 与 Z-Image 使用官方价格和路由', async () => {
    expect(await (falGptImage2Model.endpoints as { selector: (params: DynamicValueMap) => Promise<string> }).selector({ images: ['a.png'] }))
      .toBe('openai/gpt-image-2/edit')
    expect(nanoBananaProModel.pricing.calculator?.({ falNanoBananaProResolution: '4K' })).toBe(0.3)
    expect(zImageTurboModel.pricing.description).toContain('$0.005/百万像素')
    expect(zImageTurboModel.request?.builder?.({ prompt: 'edit', images: ['a.png'] })).toMatchObject({
      image_url: 'a.png', strength: 0.6
    })
  })

  it('Kling 三个型号按档位与媒体切换 Fal 官方端点', async () => {
    const standard = falKling30Model.endpoints as { selector: (params: DynamicValueMap) => Promise<string> }
    const turbo = falKling30TurboModel.endpoints as { selector: (params: DynamicValueMap) => Promise<string> }
    const omni = falKling30OmniModel.endpoints as { selector: (params: DynamicValueMap) => Promise<string> }
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
    const endpoints = falNanoBanana2Model.endpoints as { selector: (params: DynamicValueMap) => Promise<string> }
    expect(await endpoints.selector({ falNanoBanana2PdfUrl: 'https://example.com/context.pdf' }))
      .toBe('fal-ai/nano-banana-2/edit')
    expect(falNanoBanana2Model.request?.builder?.({
      prompt: 'read context', falNanoBanana2PdfUrl: 'https://example.com/context.pdf'
    })).toMatchObject({ pdf_url: 'https://example.com/context.pdf' })
  })
})
