import { describe, expect, it } from 'vitest'

import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'
import { createCanvasExecutionValueSignature } from '@/features/canvas/application/canvasExecutionCache'

import { createGenerationNodeRuntimeSignaturePayload } from './generationNodeRuntime'

type Runtime = Parameters<typeof createGenerationNodeRuntimeSignaturePayload>[0]

function runtime(input: {
  storedParams: DynamicValueMap
  effectiveParams: DynamicValueMap
  data?: DynamicValueMap
}): Runtime {
  return {
    data: { prompt: '猫', params: input.storedParams, ...input.data },
    injectedValues: {},
    promptIsOverridden: false,
    promptOverride: undefined,
    promptDocument: createPlainTextPromptDocument('猫'),
    promptReferences: [],
    images: ['source.png'],
    videos: [],
    audios: [],
    modelId: 'test-model',
    model: { meta: { id: 'test-model', canonicalModelId: 'test', provider: 'test' } },
    providerKeyConfigured: true,
    modelParamValues: input.effectiveParams,
  } as unknown as Runtime
}

describe('createGenerationNodeRuntimeSignaturePayload', () => {
  it('忽略等价的原始参数回写，但识别最终请求参数变化', () => {
    const beforeLinkageWriteback = runtime({
      storedParams: {},
      effectiveParams: { aspect_ratio: '1:1' },
    })
    const afterEquivalentWriteback = runtime({
      storedParams: { aspect_ratio: '1:1' },
      effectiveParams: { aspect_ratio: '1:1' },
    })
    const changedRuntimeDefault = runtime({
      storedParams: {},
      effectiveParams: { aspect_ratio: '16:9' },
    })
    const signature = (value: Runtime): string => createCanvasExecutionValueSignature(
      createGenerationNodeRuntimeSignaturePayload(value),
    )

    expect(signature(beforeLinkageWriteback)).toBe(signature(afterEquivalentWriteback))
    expect(signature(beforeLinkageWriteback)).not.toBe(signature(changedRuntimeDefault))
  })

  it('节点展示与工具布局属性不会让已缓存的生成语义失效', () => {
    const signature = (value: Runtime): string => createCanvasExecutionValueSignature(
      createGenerationNodeRuntimeSignaturePayload(value),
    )
    const before = runtime({
      storedParams: {},
      effectiveParams: { aspect_ratio: '1:1' },
      data: {
        displayName: '原标题',
        aspectRatio: '1:1',
        isSizeManuallyAdjusted: false,
        generationUi: {
          promptMode: 'required',
          modelMode: 'selectable',
          layoutMode: 'stacked',
          excludeParamIds: [],
          promptMaxCharacters: 2_000,
        },
      },
    })
    const afterResizeAndRename = runtime({
      storedParams: {},
      effectiveParams: { aspect_ratio: '1:1' },
      data: {
        displayName: '新标题',
        aspectRatio: '16:9',
        isSizeManuallyAdjusted: true,
        generationUi: {
          promptMode: 'hidden',
          modelMode: 'locked',
          layoutMode: 'workbench',
          excludeParamIds: ['aspect_ratio'],
          promptMaxCharacters: 200,
        },
      },
    })

    expect(signature(before)).toBe(signature(afterResizeAndRename))
  })
})
