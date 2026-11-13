/** 火山方舟（volcengine）模型的展示补丁：i18n 文案、联动、面板布局。按模型 id 关联运行时定义。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation, ParamOptionPresentation } from '@/core/types/ModelPresentation'
import { outputCountWithinImageBudget } from './mediaPresence'

const labels = (values: readonly string[], named: Record<string, I18nText> = {}): Record<string, ParamOptionPresentation> =>
  Object.fromEntries(values.map(value => [value, { label: named[value] ?? value }]))

function seedancePresentation(id: string, name: string, prefix: string, resolutions: string[], is25: boolean): ModelPresentation {
  const maxImages = is25 ? 30 : 9
  const maxAudios = is25 ? 10 : 3
  const maxVideos = is25 ? 10 : 3
  const maxVideoSeconds = is25 ? 30 : 15
  return {
    meta: { name: { key: 'meta.name', fallback: name }, i18nScope: `models.defs.${id}` },
    params: {
      [`${prefix}Mode`]: {
        name: sharedFieldText('mode'),
        role: 'mode',
        optionLabels: labels(['text-image-to-video', 'reference-to-video'], {
          'text-image-to-video': sharedModeText('textImageToVideo'),
          'reference-to-video': sharedModeText('referenceToVideo'),
        }),
        tooltip: {
          zh: `文/图生视频：1 张图为首帧，2 张为首尾帧。参考生视频可放最多 ${maxImages} 张图、${maxVideos} 段视频（合计 ${maxVideoSeconds} 秒内）、${maxAudios} 段音频${is25 ? '' : '（音频需搭配参考图或视频）'}。本地视频会经设置里的通用文件上传服务托管后提交。`,
          en: `Text/Image to Video: 1 image is the first frame, 2 are first and last frames. Reference takes up to ${maxImages} images, ${maxVideos} videos (${maxVideoSeconds}s in total) and ${maxAudios} audio clips${is25 ? '' : ' (audio needs a reference image or video)'}. Local videos are hosted through the file upload service in Settings before submitting.`,
        },
      },
      ...(is25 ? {
        [`${prefix}TaskType`]: {
          name: { zh: '任务类型', en: 'Task Type' },
          // 决定是否必须有参考视频、比例是否强制自适应、时长是否失效，属于模式级选择。
          role: 'mode' as const,
          optionLabels: labels(['auto', 'reference', 'edit', 'extend'], {
            auto: { zh: '自动判断', en: 'Automatic' },
            reference: { zh: '参考生成', en: 'Reference' },
            edit: { zh: '视频编辑', en: 'Video Edit' },
            extend: { zh: '视频延长', en: 'Video Extend' },
          }),
          tooltip: {
            zh: '视频编辑与延长需要至少一段参考视频，比例跟随原视频；编辑的时长也跟随原视频。',
            en: 'Video edit and extend need at least one reference video and follow its aspect ratio; edit also follows its duration.',
          },
        },
      } : {}),
      [`${prefix}AspectRatio`]: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: labels(['smart', '1:1', '4:3', '3:4', '16:9', '9:16', '21:9'], { smart: sharedOptionText('smart') }),
      },
      [`${prefix}Resolution`]: {
        name: sharedFieldText('resolution'),
        optionLabels: labels(resolutions, { '4k': '4K' }),
      },
      [`${prefix}Duration`]: { name: sharedFieldText('duration') },
      ...(is25 ? { [`${prefix}AutoDuration`]: { name: { zh: '自动时长', en: 'Automatic Duration' } } } : {}),
      [`${prefix}GenerateAudio`]: { name: sharedFieldText('generateAudio') },
      [`${prefix}ReturnLastFrame`]: { name: { zh: '返回尾帧', en: 'Return Last Frame' } },
      [`${prefix}WebSearch`]: { name: { zh: '联网搜索', en: 'Web Search' } },
    },
    linkages: [],
  }
}

export const volcenginePresentation: Record<string, ModelPresentation> = {
  'volcengine-seedance-2.5': seedancePresentation('volcengine-seedance-2.5', 'Seedance 2.5', 'volcengineSeedance25', ['480p', '720p', '1080p'], true),
  'volcengine-seedance-2.0': seedancePresentation('volcengine-seedance-2.0', 'Seedance 2.0', 'volcengineSeedance20', ['480p', '720p', '1080p', '4k'], false),
  'volcengine-seedance-2.0-fast': seedancePresentation('volcengine-seedance-2.0-fast', 'Seedance 2.0 Fast', 'volcengineSeedance20Fast', ['480p', '720p'], false),
  'volcengine-seedance-2.0-mini': seedancePresentation('volcengine-seedance-2.0-mini', 'Seedance 2.0 Mini', 'volcengineSeedance20Mini', ['480p', '720p'], false),

  'volcengine-seedream-5.0-lite': {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Lite' },
      i18nScope: 'models.defs.volcengine-seedream-5.0-lite',
    },
    params: {
      volcengineSeedream50LiteAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
          '21:9': { label: '21:9' },
        },
      },
      volcengineSeedream50LiteResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '2K': { label: '2K' },
          '3K': { label: '3K' },
          '4K': { label: '4K' },
        },
      },
      volcengineSeedream50LiteCount: {
        name: { zh: '最大生成数量', en: 'Maximum Outputs' },
      },
    },
    linkages: outputCountWithinImageBudget('volcengineSeedream50LiteCount', 15),
  },

  'volcengine-seedream-5.0-pro': {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Pro' },
      i18nScope: 'models.defs.volcengine-seedream-5.0-pro',
    },
    params: {
      volcengineSeedream50ProMode: {
        name: { zh: '模式', en: 'Mode' },
        role: 'mode',
        optionLabels: {
          generate: { label: { zh: '生成 / 编辑', en: 'Generate / Edit' } },
          'layer-decomposition': { label: { zh: '图层拆分', en: 'Layer Decomposition' } },
        },
      },
      volcengineSeedream50ProAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
          '21:9': { label: '21:9' },
        },
      },
      volcengineSeedream50ProResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream50ProLayerSize: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream50ProBackground: {
        name: { zh: '背景', en: 'Background' },
        optionLabels: {
          opaque: { label: { zh: '不透明', en: 'Opaque' } },
          transparent: { label: { zh: '透明', en: 'Transparent' } },
        },
      },
    },
    linkages: [],
  },
  'volcengine-seedream-5.0-flash': {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.0 Flash' },
      i18nScope: 'models.defs.volcengine-seedream-5.0-flash',
    },
    params: {
      volcengineSeedream50FlashMode: {
        name: { zh: '模式', en: 'Mode' },
        role: 'mode',
        optionLabels: {
          generate: { label: { zh: '生成 / 编辑', en: 'Generate / Edit' } },
          'layer-decomposition': { label: { zh: '图层拆分', en: 'Layer Decomposition' } },
        },
      },
      volcengineSeedream50FlashAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
          '21:9': { label: '21:9' },
        },
      },
      volcengineSeedream50FlashResolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream50FlashLayerSize: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream50FlashBackground: {
        name: { zh: '背景', en: 'Background' },
        optionLabels: {
          opaque: { label: { zh: '不透明', en: 'Opaque' } },
          transparent: { label: { zh: '透明', en: 'Transparent' } },
        },
      },
    },
    linkages: [],
  },

  'volcengine-seedream-5.5': {
    meta: {
      name: { key: 'meta.name', fallback: 'Seedream 5.5' },
      i18nScope: 'models.defs.volcengine-seedream-5.5',
    },
    params: {
      volcengineSeedream55Mode: {
        name: { zh: '模式', en: 'Mode' },
        role: 'mode',
        optionLabels: {
          generate: { label: { zh: '生成 / 编辑', en: 'Generate / Edit' } },
          'layer-decomposition': { label: { zh: '图层拆分', en: 'Layer Decomposition' } },
        },
      },
      volcengineSeedream55AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: {
          smart: { label: sharedOptionText('smart') },
          '1:1': { label: '1:1' },
          '4:3': { label: '4:3' },
          '3:4': { label: '3:4' },
          '16:9': { label: '16:9' },
          '9:16': { label: '9:16' },
          '3:2': { label: '3:2' },
          '2:3': { label: '2:3' },
          '21:9': { label: '21:9' },
        },
      },
      volcengineSeedream55Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream55LayerSize: {
        name: sharedFieldText('resolution'),
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          '1K': { label: '1K' },
          '1.5K': { label: '1.5K' },
          '2K': { label: '2K' },
        },
      },
      volcengineSeedream55Background: {
        name: { zh: '背景', en: 'Background' },
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          transparent: { label: { zh: '透明', en: 'Transparent' } },
          opaque: { label: { zh: '不透明', en: 'Opaque' } },
        },
        description: { zh: '透明直接输出带透明通道的 PNG，文生图也可用；自动由模型按提示词判断', en: 'Transparent outputs PNG with alpha, including text to image; auto lets the model decide from the prompt' },
      },
    },
    linkages: [],
  },
}
