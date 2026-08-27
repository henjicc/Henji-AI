import { describe, expect, it } from 'vitest'

import { DEFAULT_LLM_CAPABILITIES } from '@/core/llm/defaults'
import type { LlmConfigState } from '@henjicc/ai-sdk'
import {
  buildTextProcessingRequest,
  createTextProcessingInputFingerprint,
  getTextProcessingMediaKinds,
  listTextProcessingModels,
  resolveTextProcessingSystemPrompt,
  resolveTextProcessingModel,
  shouldReuseTextProcessingOutput,
} from './textProcessing'

function createConfig(): LlmConfigState {
  return {
    providers: [
      { providerId: 'active', displayName: '可用供应商', adapter: 'openai', enabled: true },
      { providerId: 'disabled', displayName: '停用供应商', adapter: 'openai', enabled: false },
    ],
    models: [
      {
        providerId: 'active',
        modelId: 'multimodal',
        displayName: '多模态模型',
        adapter: 'openai',
        capabilities: {
          ...DEFAULT_LLM_CAPABILITIES,
          image: true,
          video: true,
          audio: false,
        },
        enabled: true,
      },
      {
        providerId: 'disabled',
        modelId: 'hidden',
        displayName: '隐藏模型',
        adapter: 'openai',
        capabilities: DEFAULT_LLM_CAPABILITIES,
        enabled: true,
      },
    ],
    promptProfiles: [],
    textProcessingPromptTemplates: [],
    agentProfiles: [],
    tools: [],
    policy: { allowedTools: [], requireHumanConfirmation: false },
    memory: {},
  }
}

describe('textProcessing', () => {
  it('只列出可用文本模型，并按模型能力给出媒体行', () => {
    const choices = listTextProcessingModels(createConfig())

    expect(choices).toHaveLength(1)
    expect(choices[0].label).toBe('可用供应商 · 多模态模型')
    expect(getTextProcessingMediaKinds(choices[0].model)).toEqual(['image', 'video'])
    expect(resolveTextProcessingModel(choices, 'missing', 'missing')).toBe(choices[0])
  })

  it('把提示词与媒体组装为流式 LLM 请求，并保留本地媒体上传索引', () => {
    const choice = listTextProcessingModels(createConfig())[0]
    const request = buildTextProcessingRequest({
      requestId: 'request-1',
      prompt: '分析这些素材',
      systemPrompt: '你是一名严谨的素材分析师。',
      choice,
      media: {
        image: ['C:/media/image.png'],
        video: ['C:/media/video.mp4'],
        audio: ['C:/media/voice.wav'],
      },
      uploadProvider: 'kie',
      uploadFallback: true,
    })

    expect(request.messages[0]).toEqual({
      role: 'system',
      content: '你是一名严谨的素材分析师。',
    })
    expect(request.messages[1].content).toEqual([
      { type: 'text', text: '分析这些素材' },
      { type: 'image_url', imageUrl: { url: 'C:/media/image.png' } },
      { type: 'video_url', videoUrl: { url: 'C:/media/video.mp4' } },
      { type: 'input_audio', inputAudio: { data: 'C:/media/voice.wav', format: 'wav' } },
    ])
    expect(request.metadata).toMatchObject({
      uploadedFilePaths: ['C:/media/image.png'],
      uploadedVideoFilePaths: ['C:/media/video.mp4'],
      uploadedAudioFilePaths: ['C:/media/voice.wav'],
      __upload_provider: 'kie',
      __upload_fallback: true,
    })
  })

  it('系统提示词为空时不发送空的 system 消息', () => {
    const choice = listTextProcessingModels(createConfig())[0]
    const request = buildTextProcessingRequest({
      requestId: 'request-2',
      prompt: '直接回答',
      systemPrompt: '   ',
      choice,
      media: { image: [], video: [], audio: [] },
      uploadProvider: 'kie',
      uploadFallback: false,
    })

    expect(request.messages).toHaveLength(1)
    expect(request.messages[0]).toMatchObject({ role: 'user' })
  })

  it('预设模板覆盖自定义系统提示词，模板失效时安全回退到自定义', () => {
    const templates = [{
      id: 'optimizer',
      name: '优化器',
      systemPrompt: '只输出优化结果。',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }]

    expect(resolveTextProcessingSystemPrompt('自定义内容', 'optimizer', templates))
      .toBe('只输出优化结果。')
    expect(resolveTextProcessingSystemPrompt('自定义内容', 'missing', templates))
      .toBe('自定义内容')
    expect(resolveTextProcessingSystemPrompt('自定义内容', 'custom', templates))
      .toBe('自定义内容')
  })

  it('输入指纹稳定判等，并在模型、提示词或媒体变化时失效', () => {
    const base = {
      prompt: '优化提示词',
      systemPrompt: '只输出结果',
      providerId: 'active',
      modelId: 'multimodal',
      media: { image: ['image-a'], video: [], audio: [] },
    }
    const fingerprint = createTextProcessingInputFingerprint(base)

    expect(createTextProcessingInputFingerprint({ ...base })).toBe(fingerprint)
    expect(createTextProcessingInputFingerprint({ ...base, prompt: '另一条提示词' })).not.toBe(fingerprint)
    expect(createTextProcessingInputFingerprint({ ...base, modelId: 'other-model' })).not.toBe(fingerprint)
    expect(createTextProcessingInputFingerprint({
      ...base,
      media: { ...base.media, image: ['image-b'] },
    })).not.toBe(fingerprint)
  })

  it('只在下游触发、固定结果开启、上次成功且输入未变时复用', () => {
    const reusable = {
      trigger: 'dependency' as const,
      fixedResult: true,
      lastExecutionStatus: 'success' as const,
      lastOutputFingerprint: 'v1-same',
      fingerprint: 'v1-same',
    }

    expect(shouldReuseTextProcessingOutput(reusable)).toBe(true)
    expect(shouldReuseTextProcessingOutput({ ...reusable, trigger: 'direct' })).toBe(false)
    expect(shouldReuseTextProcessingOutput({ ...reusable, fixedResult: false })).toBe(false)
    expect(shouldReuseTextProcessingOutput({ ...reusable, lastExecutionStatus: 'failed' })).toBe(false)
    expect(shouldReuseTextProcessingOutput({ ...reusable, fingerprint: 'v1-changed' })).toBe(false)
  })
})
