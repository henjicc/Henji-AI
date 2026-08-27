/** fal 模型展示补丁（第 1/7 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart1: Record<string, ModelPresentation> = {
  "fal-ai-gemini-omni-flash": {
    meta: {
      name: { key: 'meta.name', fallback: 'Gemini Omni Flash' },
      i18nScope: 'models.defs.fal-ai-gemini-omni-flash',
    },
    params: {
      "falGeminiOmniFlashMode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGeminiOmniFlashAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGeminiOmniFlashResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [{ value: '720p', label: '720p' }]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGeminiOmniFlashDuration": {
        name: sharedFieldText('duration'),
      },
    },
    linkages: [],
  },
  "fal-ai-gpt-image-2": {
    meta: {
      name: { key: 'meta.name', fallback: 'GPT Image 2' },
      i18nScope: 'models.defs.fal-ai-gpt-image-2',
    },
    params: {
      "falGptImage2AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' }, { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' }, { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGptImage2Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: 'low', label: { zh: '低质量', en: 'Low' } },
        { value: 'medium', label: { zh: '标准', en: 'Medium' } },
        { value: 'high', label: { zh: '高质量', en: 'High' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGptImage2NumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falGptImage2MaskUrl": {
        name: { zh: '局部重绘遮罩', en: 'Inpainting Mask' },
        description: { zh: '请上传带透明通道的遮罩图', en: 'Upload a mask image with alpha' },
      },
    },
    linkages: [],
  },
  "fal-ai-grok-imagine-2.0": {
    meta: {
      name: { key: 'meta.name', fallback: 'Grok Imagine Image 2.0' },
      i18nScope: 'models.defs.fal-ai-grok-imagine-2.0',
    },
    params: {
      "falGrokImagine20AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['2:1', '20:9', '19.5:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:19.5', '9:20', '1:2'] as const).map((value) => ({ value, label: value }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGrokImagine20Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '2K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGrokImagine20Quality": {
        name: { zh: '质量', en: 'Quality' },
        optionLabels: Object.fromEntries((
          [{ value: 'low', label: { zh: '低', en: 'Low' } }, { value: 'medium', label: { zh: '标准', en: 'Medium' } }]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGrokImagine20NumImages": {
        name: sharedFieldText('numberOfImages'),
      },
    },
    linkages: [],
  },
  "fal-ai-minimax-hailuo-02": {
    meta: {
      name: { key: 'meta.name', fallback: 'MiniMax Hailuo 02' },
      i18nScope: 'models.defs.fal-ai-minimax-hailuo-02',
    },
    params: {
      "falHailuo02Version": {
        name: sharedFieldText('version'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: 'Standard' },
        { value: 'pro', label: 'Pro' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falHailuo02Duration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: '6', label: '6s' },
        { value: '10', label: '10s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falHailuo02Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '512P', label: '512P' },
        { value: '768P', label: '768P' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falHailuo02FastMode": {
        name: sharedFieldText('fastMode'),
      },
      "falHailuo02PromptOptimizer": {
        name: sharedFieldText('promptOptimizer'),
      },
    },
    linkages: [],
  },
  "fal-ai-minimax-hailuo-2.3": {
    meta: {
      name: { key: 'meta.name', fallback: 'MiniMax Hailuo 2.3' },
      i18nScope: 'models.defs.fal-ai-minimax-hailuo-2.3',
    },
    params: {
      "falHailuo23Version": {
        name: sharedFieldText('version'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: 'Standard' },
        { value: 'pro', label: 'Pro' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falHailuo23Duration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: '6', label: '6s' },
        { value: '10', label: '10s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falHailuo23FastMode": {
        name: sharedFieldText('fastMode'),
      },
      "falHailuo23PromptOptimizer": {
        name: sharedFieldText('promptOptimizer'),
      },
    },
    linkages: [],
  },
  "fal-ai-kling-3.0-omni": {
    meta: {
      name: { key: 'meta.name', fallback: 'Kling 3.0 Omni' },
      i18nScope: 'models.defs.fal-ai-kling-3.0-omni',
    },
    params: {
      "falKling30OmniMode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-image-to-video', label: sharedModeText('textImageToVideo') },
        { value: 'reference-to-video', label: sharedModeText('referenceToVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKling30OmniAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKling30OmniResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: 'standard', label: { zh: '标准', en: 'Standard' } },
        { value: 'pro', label: { zh: '专业', en: 'Pro' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falKling30OmniDuration": {
        name: sharedFieldText('duration'),
      },
      "falKling30OmniGenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
    },
    linkages: [],
  },
}
