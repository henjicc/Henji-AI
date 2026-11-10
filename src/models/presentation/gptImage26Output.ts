/** GPT Image 2.6 动图与矢量图输出的展示补丁，APIMart、Fal、KIE 共用一份文案与联动。 */

import type { Linkage } from '@/core/types/Linkage'
import type { ParamPresentationEntry } from '@/core/types/ModelPresentation'
import { uploadedImageCount } from './mediaPresence'

interface Gpt26OutputIds { output: string; frameCount: string; frameDuration: string; svgModel: string }

/** 素材触发字段：对话面板与画布的实时图片值，以及影响可选项的其他参数。 */
const IMAGE_TRIGGERS = ['images', 'uploadedImages']

/** gifWithImages：该供应商的动图能否用参考图（APIMart、Fal 能，KIE 只能文生图）。 */
export function gpt26OutputParams(ids: Gpt26OutputIds, gifWithImages: boolean): Record<string, ParamPresentationEntry> {
  return {
    [ids.output]: {
      name: { zh: '输出类型', en: 'Output' },
      optionLabels: {
        image: { label: { zh: '图片', en: 'Image' } },
        gif: { label: { zh: '动图', en: 'Animated GIF' } },
        svg: { label: { zh: '矢量图', en: 'Vector SVG' } },
      },
      description: gifWithImages
        ? { zh: '图片为普通 PNG；动图输出 GIF 动画，可用参考图让画面动起来；矢量图输出 SVG，只能文生图。', en: 'Image returns PNG; Animated GIF returns an animation and can animate reference images; Vector SVG returns SVG and is text-to-image only.' }
        : { zh: '图片为普通 PNG；动图输出 GIF 动画；动图与矢量图（SVG）都只能文生图。', en: 'Image returns PNG; Animated GIF returns an animation; GIF and Vector SVG are both text-to-image only.' },
      tooltip: gifWithImages
        ? { zh: '矢量图只能文生图，有参考图时不可选。矢量图除了出图费用，还按矢量化模型的文字用量另外计费。', en: 'Vector SVG is text-to-image only and unavailable with reference images. It also bills the vectorizing model by text usage.' }
        : { zh: '动图与矢量图只能文生图，有参考图时不可选。矢量图除了出图费用，还按矢量化模型的文字用量另外计费。', en: 'GIF and Vector SVG are text-to-image only and unavailable with reference images. Vector SVG also bills the vectorizing model by text usage.' },
    },
    [ids.frameCount]: {
      name: { zh: '帧数', en: 'Frames' },
      tooltip: { zh: '所有帧拼成一整张图生成和计费，帧数越多费用越高。', en: 'All frames are generated and billed as one sheet, so more frames cost more.' },
    },
    [ids.frameDuration]: {
      name: { zh: '每帧时长', en: 'Frame duration' },
      unit: 'ms',
      description: { zh: '每一帧停留的毫秒数，按 10 毫秒取整。', en: 'Milliseconds each frame stays on screen, rounded to 10 ms.' },
    },
    [ids.svgModel]: {
      name: { zh: '矢量化模型', en: 'Vectorizing model' },
      tooltip: { zh: '把生成的图转成矢量路径的模型。模型越大形状越准，文字用量费用也越高。', en: 'Converts the generated image into vector paths. Larger models give more accurate shapes and cost more in text usage.' },
    },
  }
}

/**
 * 有参考图时裁掉不支持的输出类型（矢量图各家都只能文生图；部分端点动图也只能文生图），
 * 当前值被裁掉时退回图片。allowed 由各模型按版本补充限制。
 */
export function gpt26OutputLinkages(
  outputId: string,
  allowed: (output: string, hasImages: boolean, params: Record<string, unknown>) => boolean,
  extraTriggers: string[] = [],
): Linkage[] {
  const triggers = [...IMAGE_TRIGGERS, ...extraTriggers]
  const ok = (output: string, params: Record<string, unknown>) => allowed(output, uploadedImageCount(params) > 0, params)
  return [
    { trigger: triggers, effect: 'filterOptions', target: outputId, filter: (_, options, params) => options.filter(option => ok(String(option.value), params)) },
    {
      trigger: triggers, effect: 'reset', targets: [outputId],
      condition: (_, params) => params[outputId] !== undefined && !ok(String(params[outputId]), params),
    },
  ]
}
