import { describe, expect, it } from 'vitest'

import type { CapabilityModule } from '../src/capabilities'
import { catalog } from '../src/catalog'
import {
  createModelCapabilityDiscovery,
  profileGenerationModel,
  profileLlmCatalogEntry,
} from '../src/discovery'
import { LLM_MODEL_CATALOG_ENTRIES } from '../src/llm/modelCatalogEntries'
import { pack as falErasePack } from '../src/packs/tool-packs/fal-image-edit-tools'

const generationModels = [...catalog, ...falErasePack.models]

describe('统一模型能力画像与筛选', () => {
  it('99默认+3可选generation逐项派生合法画像', () => {
    expect(catalog).toHaveLength(99)
    expect(falErasePack.models).toHaveLength(3)
    for (const model of generationModels) {
      const profile = profileGenerationModel(model)
      expect(profile.id).toBe(model.meta.id)
      expect(profile.providerIds).toEqual([model.meta.provider])
      expect(profile.outputModalities).toEqual([model.meta.type])
      expect(profile.operations.length).toBeGreaterThan(0)
      expect(profile.acceptedInputContentKinds).toContain('text')
      expect(profile.outputContentKinds).toEqual([model.meta.type])
    }
  })

  it('真实LLM目录逐项从input/capabilities派生chat画像', () => {
    expect(LLM_MODEL_CATALOG_ENTRIES.length).toBeGreaterThan(10)
    for (const entry of LLM_MODEL_CATALOG_ENTRIES) {
      const profile = profileLlmCatalogEntry(entry)
      expect(profile.providerIds).toEqual([entry.vendor.toLowerCase()])
      expect(profile.operations).toEqual(['chat'])
      expect(profile.acceptedInputContentKinds).toContain('text')
      expect(profile.acceptedInputContentKinds.includes('image')).toBe(entry.input.image)
      expect(profile.acceptedInputContentKinds.includes('video')).toBe(entry.input.video)
      expect(profile.acceptedInputContentKinds.includes('audio')).toBe(entry.input.audio)
      expect(profile.outputContentKinds).toContain('text')
    }
  })

  it('已有generation功能tags与标准operation保持一致', () => {
    for (const model of generationModels) {
      const tags = model.meta.tags ?? []
      const operations = profileGenerationModel(model).operations
      if (tags.includes('text-to-image')) expect(operations).toContain('text-to-image')
      if (tags.some((tag) => ['image-to-image', 'supports-image-editing', 'image-edit'].includes(tag))) {
        expect(operations).toContain('image-edit')
      }
      if (model.meta.type === 'video' && tags.includes('text-to-video')) expect(operations).toContain('text-to-video')
      if (model.meta.type === 'video' && tags.some((tag) => ['image-to-video', 'start-end-frame'].includes(tag))) {
        expect(operations).toContain('image-to-video')
      }
      if (model.meta.type === 'video' && tags.some((tag) => ['reference-mode', 'video-reference', 'multi-image-reference'].includes(tag))) {
        expect(operations).toContain('reference-to-video')
      }
      if (model.meta.type === 'video' && tags.some((tag) => ['supports-video-editing', 'video-to-video', 'video-extension'].includes(tag))) {
        expect(operations).toContain('video-edit')
      }
    }
  })

  it('AND组合精确筛出Fal erase，运行时只看已导入候选pack', () => {
    const discovery = createModelCapabilityDiscovery({ generationPacks: [falErasePack] })
    expect(discovery.list()).toHaveLength(3)
    const matches = discovery.search({
      providerIds: 'fal',
      outputModalities: 'image',
      operations: 'image-edit',
      acceptedInputContentKinds: 'image',
      features: 'erase',
    })
    expect(matches.map((item) => item.id)).toEqual([
      'fal-flux-pro-erase', 'fal-bria-eraser', 'fal-finegrain-eraser',
    ])
    expect(discovery.search({ providerIds: 'kie' })).toEqual([])
  })

  it('组合筛选覆盖视频、音频与多模态chat，OR语义明确', () => {
    const discovery = createModelCapabilityDiscovery({
      generationModels: catalog,
      llmEntries: LLM_MODEL_CATALOG_ENTRIES,
    })
    const imageToVideo = discovery.search({
      outputModalities: 'video',
      operations: 'image-to-video',
      acceptedInputContentKinds: 'image',
    })
    expect(imageToVideo.length).toBeGreaterThan(0)
    expect(imageToVideo.every((item) => item.sourceKind === 'generation-model')).toBe(true)

    const audio = discovery.search({ operations: 'audio-generation', outputContentKinds: 'audio' })
    expect(audio.length).toBeGreaterThan(0)

    const multimodalChat = discovery.search({
      operations: 'chat',
      acceptedInputContentKinds: { allOf: ['text', 'image', 'video'] },
    })
    expect(multimodalChat.length).toBeGreaterThan(0)
    expect(multimodalChat.every((item) => item.sourceKind === 'llm-model')).toBe(true)

    const either = discovery.search({
      mode: 'any',
      operations: 'ocr',
      features: 'reasoning',
    })
    expect(either.length).toBeGreaterThan(0)
  })

  it('ASR/OCR扩展复用同一profile API但保留自己的执行handle', () => {
    const asr = fixtureModule('fixture-asr', 'speech-recognition', 'audio', 'text')
    const ocr = fixtureModule('fixture-ocr', 'ocr', 'image', 'structured-data')
    const discovery = createModelCapabilityDiscovery({ extensions: [asr, ocr] })
    expect(discovery.search({ operations: 'speech-recognition', acceptedInputContentKinds: 'audio' }))
      .toMatchObject([{ sourceKind: 'extension', id: 'fixture-asr' }])
    expect(discovery.search({ operations: 'ocr', outputContentKinds: 'structured-data' }))
      .toMatchObject([{ sourceKind: 'extension', id: 'fixture-ocr' }])
    expect(discovery.list()[0].source).not.toHaveProperty('generate')
  })
})

function fixtureModule(
  id: string,
  kind: string,
  input: string,
  output: string
): CapabilityModule<unknown, unknown> {
  return {
    descriptor: {
      id,
      kind,
      contract: { input: [{ kind: input }], output: [{ kind: output }] },
    },
    execute: async (value) => value,
  }
}
