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
        ...(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '2:1'] as const)
          .map((value) => ({ value, label: value }))
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falGptImage2ImageSize": {
        name: sharedFieldText('imageSize'),
        optionLabels: {
          provider: { label: { zh: '供应商预设', en: 'Provider Preset' } },
          '1MP': { label: { zh: '约 1MP', en: 'Approx. 1MP' } },
          '2K': { label: { zh: '2K 自定义尺寸', en: '2K Custom Size' } },
        },
      },
      "falGptImage2Resolution": {
        name: sharedFieldText('quality'),
        optionLabels: Object.fromEntries((
          [
        { value: 'auto', label: { zh: '自动', en: 'Auto' } },
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
        description: {
          zh: '定义基于首张参考图创建的局部重绘区域；遮罩与源图同尺寸并使用 Alpha 通道。',
          en: 'Defines the inpainting region derived from the first reference image; the mask matches the source dimensions and uses an alpha channel.',
        },
        tooltip: {
          zh: '先添加参考图，再点击“绘制”在首张图上涂抹需要重绘的区域；遮罩会自动保持与源图同尺寸。',
          en: 'Add a reference image, then choose “Draw” and paint the area to regenerate on the first image. The mask automatically matches the source dimensions.',
        },
        derivedMediaAuthoring: {
          kind: 'mask',
          source: { kind: 'first-image' },
          editor: { kind: 'mask' },
          output: {
            format: 'png',
            maskEncoding: 'alpha',
            dimensions: 'source',
            paintMeaning: 'transparent-edit',
          },
          onSourceChange: 'invalidate',
          actions: {
            create: { zh: '绘制', en: 'Draw' },
            edit: { zh: '编辑', en: 'Edit' },
          },
        },
      },
    },
    linkages: [],
  },
  "fal-ai-ic-light-v2": {
    meta: {
      name: { key: 'meta.name', fallback: 'IC-Light v2 Relighting' },
      i18nScope: 'models.defs.fal-ai-ic-light-v2',
    },
    params: {
      "falIcLightV2InitialLatent": {
        name: { zh: '初始光照方向', en: 'Initial Light Direction' },
        description: {
          zh: '离散方向偏好，不代表物理精确灯位。',
          en: 'A discrete direction preference, not a physically precise light position.',
        },
        optionLabels: {
          None: { label: { zh: '不指定', en: 'Unspecified' } },
          Left: { label: { zh: '左侧', en: 'Left' } },
          Right: { label: { zh: '右侧', en: 'Right' } },
          Top: { label: { zh: '上方', en: 'Top' } },
          Bottom: { label: { zh: '下方', en: 'Bottom' } },
        },
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
