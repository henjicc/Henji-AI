/** kie 模型展示补丁（第 7 组）：GPT Image 2.6、Kling 4.0、Wan 3.0、Grok Imagine Video 1.5、FLUX 3 Klein。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { ModelPresentation, ParamPresentationEntry } from '@/core/types/ModelPresentation'
import { falPresentation } from '../fal'
import { kling40ElementsPresentation } from '../kling-4.0'

const special: Record<string, I18nText> = {
  smart: sharedOptionText('smart'), auto: sharedOptionText('auto'), adaptive: sharedOptionText('adaptive'),
}
const labels = (values: readonly string[]) => Object.fromEntries(values.map(value => [value, { label: special[value] ?? value }]))
const meta = (id: string, fallback: string) => ({ name: { key: 'meta.name', fallback }, i18nScope: `models.defs.${id}` })

const GPT26_RATIOS = ['smart', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3']
const GPT26_ECONOMY_RATIOS = ['smart', '1:1', '16:9', '9:16', '3:2', '2:3', '21:9', '4:3']

const gptImage26: ModelPresentation = {
  meta: meta('kie-gpt-image-2.6', 'GPT Image 2.6'),
  params: {
    kieGpt26Variant: {
      role: 'mode', name: { zh: '版本', en: 'Version' },
      optionLabels: { flare: { label: 'Flare' }, sunburst: { label: 'Sunburst' }, economy: { label: { zh: 'Economy · 1K', en: 'Economy · 1K' } } },
      tooltip: {
        zh: 'Flare 出图快，Sunburst 细节与多轮编辑一致性更好，两者按 Token 计费；Economy 固定 1K、按张计费，不支持质量、规划强度和局部重绘。',
        en: 'Flare is faster; Sunburst keeps more detail across edits. Both bill by tokens. Economy is fixed at 1K, billed per image, without quality, planning or inpainting.',
      },
    },
    kieGpt26AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(GPT26_RATIOS) },
    kieGpt26Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['1K', '2K', '4K']) },
    kieGpt26Quality: {
      name: sharedFieldText('quality'),
      optionLabels: {
        auto: { label: sharedOptionText('auto') }, low: { label: { zh: '低', en: 'Low' } },
        medium: { label: { zh: '标准', en: 'Medium' } }, high: { label: { zh: '高', en: 'High' } },
        xhigh: { label: { zh: '超高', en: 'Extra high' } }, max: { label: { zh: '最高', en: 'Maximum' } },
      },
      tooltip: { zh: '更高质量通常增加耗时和费用；自动档按最高档预估费用，实际由模型选择的质量结算。', en: 'Higher quality usually costs more and takes longer. Auto is estimated at the maximum level and billed by the level the model picks.' },
    },
    kieGpt26Complexity: {
      name: { zh: '规划强度', en: 'Planning' },
      optionLabels: { low: { label: { zh: '低', en: 'Low' } }, medium: { label: { zh: '中', en: 'Medium' } }, high: { label: { zh: '高', en: 'High' } } },
      tooltip: { zh: '密集文字、复杂排版选高；只改局部时选低，避免额外改动。不单独收费。', en: 'Use high for dense text and complex layouts, low for focused edits. No extra charge.' },
    },
    kieGpt26Background: {
      name: { zh: '背景', en: 'Background' },
      optionLabels: { auto: { label: sharedOptionText('auto') }, opaque: { label: { zh: '不透明', en: 'Opaque' } }, transparent: { label: { zh: '透明', en: 'Transparent' } } },
    },
    // 复用已登记的遮罩创作契约，让生成面板与画布共同使用同一个编辑器。
    kieGpt26Mask: falPresentation['fal-ai-gpt-image-2'].params.falGptImage2MaskUrl,
  },
  linkages: [
    {
      trigger: 'kieGpt26Variant', effect: 'filterOptions', target: 'kieGpt26AspectRatio',
      filter: (variant, options) => options.filter(o => variant !== 'economy' || GPT26_ECONOMY_RATIOS.includes(String(o.value))),
    },
    // filterOptions 只裁剪菜单，不修改已选值；切到 Economy 后不支持的比例恢复默认。
    {
      trigger: 'kieGpt26Variant', effect: 'reset', targets: ['kieGpt26AspectRatio'],
      condition: (variant, params) => variant === 'economy' && !GPT26_ECONOMY_RATIOS.includes(String(params.kieGpt26AspectRatio)),
    },
  ],
}

function kling40(id: string, name: string, withResolution: boolean): ModelPresentation {
  const p = id === 'kie-kling-4.0' ? 'kieKling40' : 'kieKling40Flash'
  const params: Record<string, ParamPresentationEntry> = {
    [`${p}Mode`]: {
      name: sharedFieldText('mode'), role: 'mode',
      optionLabels: {
        'text-image-to-video': { label: sharedModeText('textImageToVideo') },
        'reference-to-video': { label: sharedModeText('referenceToVideo') },
      },
      tooltip: withResolution
        ? { zh: '文/图生视频：多张图依次作为首帧、中间帧和尾帧，可在提示词里用 @first_frame、@keyframe_1、@last_frame 指代。参考生视频：用 @image_1、@video_1 指代参考图和参考视频。', en: 'Text/Image to Video: images become first, middle and last frames; mention them as @first_frame, @keyframe_1, @last_frame. Reference: mention assets as @image_1, @video_1.' }
        : { zh: '文/图生视频只支持首帧，可在提示词里用 @first_frame 指代。参考生视频：用 @image_1、@video_1 指代参考图和参考视频，参考视频总时长需在 2–20 秒。', en: 'Text/Image to Video takes a first frame only (@first_frame). Reference: mention assets as @image_1, @video_1; reference videos must total 2–20 seconds.' },
    },
    [`${p}AspectRatio`]: {
      name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', '16:9', '9:16', '1:1', '21:9']),
      tooltip: { zh: '上传首帧时画面比例跟随首帧。', en: 'When a first frame is provided, the output follows its aspect ratio.' },
    },
    [`${p}Duration`]: { name: sharedFieldText('duration') },
    [`${p}KeepOriginalSound`]: { name: sharedFieldText('keepOriginalSound') },
    [`${p}Elements`]: kling40ElementsPresentation('named'),
  }
  if (withResolution) params[`${p}Resolution`] = { name: sharedFieldText('resolution'), optionLabels: labels(['720p', '1080p']) }
  return { meta: meta(id, name), params, linkages: [] }
}

function wan30(id: string, name: string, p: string): ModelPresentation {
  return {
    meta: meta(id, name),
    params: {
      [`${p}Mode`]: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo') },
          'reference-to-video': { label: sharedModeText('referenceToVideo') },
        },
        tooltip: { zh: '文/图生视频：可传首帧，或首帧加尾帧。参考生视频：最多 10 张图、5 段视频、5 段音频，提示词里用 Image1、Video1、Audio1 指代；参考视频时长加输出时长不超过 30 秒。', en: 'Text/Image to Video takes a first frame, or first and last frames. Reference mode takes up to 10 images, 5 videos and 5 audio clips, mentioned as Image1, Video1, Audio1; reference video length plus output must not exceed 30 s.' },
      },
      [`${p}AspectRatio`]: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16']) },
      [`${p}Resolution`]: { name: sharedFieldText('resolution'), optionLabels: labels(['480p', '720p', '1080p']) },
      [`${p}Duration`]: { name: sharedFieldText('duration') },
      [`${p}Audio`]: { name: sharedFieldText('generateAudio') },
    },
    linkages: [],
  }
}

export const kiePresentationPart7: Record<string, ModelPresentation> = {
  'kie-gpt-image-2.6': gptImage26,
  'kie-kling-4.0': kling40('kie-kling-4.0', 'Kling 4.0', true),
  'kie-kling-4.0-flash': kling40('kie-kling-4.0-flash', 'Kling 4.0 Flash', false),
  'kie-wan-3.0': wan30('kie-wan-3.0', 'Wan 3.0', 'kieWan30'),
  'kie-wan-3.0-prime': wan30('kie-wan-3.0-prime', 'Wan 3.0 Prime', 'kieWan30Prime'),
  'kie-grok-imagine-video-1.5': {
    meta: meta('kie-grok-imagine-video-1.5', 'Grok Imagine Video 1.5'),
    params: {
      kieGrokVideo15AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['auto', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']) },
      kieGrokVideo15Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['480p', '720p']) },
      kieGrokVideo15Duration: { name: sharedFieldText('duration') },
    },
    linkages: [],
  },
  'kie-flux-3-klein': {
    meta: meta('kie-flux-3-klein', 'FLUX 3 Klein'),
    params: {
      kieFlux3KleinAspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21']) },
      kieFlux3KleinResolution: { name: sharedFieldText('resolution'), optionLabels: labels(['1K', '2K', '4K']) },
      kieFlux3KleinCount: { name: sharedFieldText('numberOfImages') },
      kieFlux3KleinEnhancePrompt: { name: sharedFieldText('enhancePrompt') },
    },
    linkages: [],
  },
}
