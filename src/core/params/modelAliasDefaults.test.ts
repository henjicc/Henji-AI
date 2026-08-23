import { describe, expect, it } from 'vitest'

import type { ModelDefinition } from '@/core/types'
import {
  mergeModelAliasParamDefaults,
  normalizeModelAliasParams,
} from './modelAliasDefaults'

const midjourneyModel = {
  meta: {
    id: 'apimart-midjourney',
    aliasParamDefaults: {
      'apimart-midjourney-blend': { apimartMidjourneyMode: 'blend' },
    },
    aliasParamMappings: {
      'apimart-midjourney-blend': {
        apimartMidjourneyBlendAspectRatio: 'apimartMidjourneyAspectRatio',
        apimartMidjourneyBlendSpeed: 'apimartMidjourneySpeed',
      },
    },
  },
} as unknown as ModelDefinition

const geminiModel = {
  meta: {
    id: 'apimart-gemini-omni-flash',
    aliasParamMappings: {
      official: {
        apimartGeminiOmniFlashDuration: 'apimartGeminiOmniFlashOfficialDuration',
      },
      ext: {
        apimartGeminiOmniFlashExtGenerationType: 'apimartGeminiOmniFlashGenerationType',
        apimartGeminiOmniFlashExtAspectRatio: 'apimartGeminiOmniFlashAspectRatio',
        apimartGeminiOmniFlashExtResolution: 'apimartGeminiOmniFlashResolution',
      },
    },
  },
} as unknown as ModelDefinition

describe('旧模型入口参数兼容', () => {
  it('旧 Midjourney Blend 同时恢复模式、比例和速度', () => {
    expect(mergeModelAliasParamDefaults(
      'apimart-midjourney-blend',
      midjourneyModel,
      {
        apimartMidjourneyBlendAspectRatio: '16:9',
        apimartMidjourneyBlendSpeed: 'turbo',
      },
    )).toMatchObject({
      apimartMidjourneyMode: 'blend',
      apimartMidjourneyAspectRatio: '16:9',
      apimartMidjourneySpeed: 'turbo',
    })
  })

  it('模型 ID 已规范化后仍能恢复旧 Gemini 参数名', () => {
    expect(normalizeModelAliasParams(geminiModel, {
      apimartGeminiOmniFlashDuration: 8,
      apimartGeminiOmniFlashExtAspectRatio: '9:16',
      apimartGeminiOmniFlashExtResolution: '4k',
      apimartGeminiOmniFlashExtGenerationType: 'frame',
    })).toMatchObject({
      apimartGeminiOmniFlashOfficialDuration: 8,
      apimartGeminiOmniFlashAspectRatio: '9:16',
      apimartGeminiOmniFlashResolution: '4k',
      apimartGeminiOmniFlashGenerationType: 'frame',
    })
  })

  it('当前参数值优先于旧参数映射', () => {
    expect(normalizeModelAliasParams(midjourneyModel, {
      apimartMidjourneyAspectRatio: '1:1',
      apimartMidjourneyBlendAspectRatio: '16:9',
    }).apimartMidjourneyAspectRatio).toBe('1:1')
  })
})
