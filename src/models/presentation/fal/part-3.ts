/** fal 模型展示补丁（第 3/7 组）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation } from '@/core/types/ModelPresentation'

export const falPresentationPart3: Record<string, ModelPresentation> = {
  "fal-ai-ltx-2": {
    meta: {
      name: { key: 'meta.name', fallback: 'LTX 2' },
      i18nScope: 'models.defs.fal-ai-ltx-2',
    },
    params: {
      "falLtx2Mode": {
        name: sharedFieldText('mode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'text-to-video', label: sharedModeText('textToVideo') },
        { value: 'image-to-video', label: sharedModeText('imageToVideo') },
        { value: 'retake-video', label: sharedModeText('retakeVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falLtx2Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          [
        { value: '1080p', label: '1080p' },
        { value: '1440p', label: '1440p' },
        { value: '2160p', label: '2160p' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falLtx2VideoDuration": {
        name: sharedFieldText('duration'),
        optionLabels: Object.fromEntries((
          [
        { value: 6, label: '6s' },
        { value: 8, label: '8s' },
        { value: 10, label: '10s' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falLtx2RetakeDuration": {
        name: sharedFieldText('retakeDuration'),
      },
      "falLtx2Fps": {
        name: sharedFieldText('fps'),
        optionLabels: Object.fromEntries((
          [
        { value: 25, label: '25 FPS' },
        { value: 50, label: '50 FPS' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falLtx2GenerateAudio": {
        name: sharedFieldText('generateAudio'),
      },
      "falLtx2FastMode": {
        name: sharedFieldText('fastMode'),
      },
      "falLtx2RetakeStartTime": {
        name: sharedFieldText('startTime'),
      },
      "falLtx2RetakeMode": {
        name: sharedFieldText('retakeMode'),
        optionLabels: Object.fromEntries((
          [
        { value: 'replace_audio', label: sharedOptionText('replaceAudio') },
        { value: 'replace_video', label: sharedOptionText('replaceVideo') },
        { value: 'replace_audio_and_video', label: sharedOptionText('replaceAudioAndVideo') }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
    },
    linkages: [],
  },
  "fal-ai-minimax-h3": {
    meta: {
      name: { key: 'meta.name', fallback: 'MiniMax H3' },
      i18nScope: 'models.defs.fal-ai-minimax-h3',
    },
    params: {
      "falMiniMaxH3Mode": {
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
      "falMiniMaxH3AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '21:9', label: '21:9' }, { value: '16:9', label: '16:9' },
        { value: '4:3', label: '4:3' }, { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' }, { value: '9:16', label: '9:16' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falMiniMaxH3Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['480P', '768P', '2K', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falMiniMaxH3Duration": {
        name: sharedFieldText('duration'),
      },
      "falMiniMaxH3PromptExpansion": {
        name: sharedFieldText('promptExpansion'),
      },
      "falMiniMaxH3PromptExpansionMode": {
        name: { zh: '提示词扩写模式', en: 'Prompt Expansion Mode' },
        optionLabels: Object.fromEntries((
          [
        { value: 'balanced', label: { zh: '平衡', en: 'Balanced' } },
        { value: 'fast', label: { zh: '快速', en: 'Fast' } },
        { value: 'quality', label: { zh: '高质量', en: 'Quality' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
    },
    linkages: [],
  },
  "fal-ai-nano-banana-2": {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana 2' },
      i18nScope: 'models.defs.fal-ai-nano-banana-2',
    },
    params: {
      "falNanoBanana2AspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'] as const).map((value) => ({ value, label: value }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falNanoBanana2Resolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['0.5K', '1K', '2K', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falNanoBanana2NumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falNanoBanana2WebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
      "falNanoBanana2Thinking": {
        name: { zh: '思考强度', en: 'Thinking' },
        optionLabels: Object.fromEntries((
          [
        { value: 'off', label: { zh: '关闭', en: 'Off' } },
        { value: 'minimal', label: { zh: '最少', en: 'Minimal' } },
        { value: 'high', label: { zh: '高', en: 'High' } }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falNanoBanana2PdfUrl": {
        name: { zh: 'PDF 上下文', en: 'PDF Context' },
        uploadButtonText: { zh: '上传 PDF', en: 'Upload PDF' },
      },
    },
    linkages: [],
  },
  "fal-ai-nano-banana-pro": {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana Pro' },
      i18nScope: 'models.defs.fal-ai-nano-banana-pro',
    },
    params: {
      "falNanoBananaProAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [{ value: 'smart', label: sharedOptionText('smart') }, ...(['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] as const).map((value) => ({ value, label: value }))]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falNanoBananaProResolution": {
        name: sharedFieldText('resolution'),
        optionLabels: Object.fromEntries((
          ['1K', '2K', '4K'].map((value) => ({ value, label: value }))
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
      "falNanoBananaProNumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falNanoBananaProWebSearch": {
        name: { zh: '联网搜索', en: 'Web Search' },
      },
    },
    linkages: [],
  },
  "fal-ai-nano-banana": {
    meta: {
      name: { key: 'meta.name', fallback: 'Nano Banana' },
      i18nScope: 'models.defs.fal-ai-nano-banana',
    },
    params: {
      "falNanoBananaNumImages": {
        name: sharedFieldText('numberOfImages'),
      },
      "falNanoBananaAspectRatio": {
        name: sharedFieldText('aspectRatio'),
        optionLabels: Object.fromEntries((
          [
        { value: 'smart', label: sharedOptionText('smart') },
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '21:9', label: '21:9' },
        { value: '3:2', label: '3:2' },
        { value: '2:3', label: '2:3' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
        { value: '5:4', label: '5:4' },
        { value: '4:5', label: '4:5' }
      ]
        ).map((rawOption) => {
          const option = rawOption as { value: string | number; label?: I18nText; description?: I18nText }
          return [String(option.value), {
            label: option.label ?? String(option.value),
            ...(option.description === undefined ? {} : { description: option.description }),
          }]
        })),
      },
    },
    linkages: [
  ],
  },
}
