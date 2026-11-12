/** apimart 模型展示补丁（第 7 组：万相 2.7 Image、FLUX 3 Video）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { Linkage } from '@/core/types/Linkage'
import type { ModelPresentation, ParamOptionPresentation } from '@/core/types/ModelPresentation'

const labels = (values: readonly string[], named: Record<string, I18nText> = {}): Record<string, ParamOptionPresentation> =>
  Object.fromEntries(values.map(value => [value, { label: named[value] ?? value }]))

const meta = (id: string, fallback: string) => ({ name: { key: 'meta.name', fallback }, i18nScope: `models.defs.${id}` })

function hasUploadedImage(params: Record<string, unknown>): boolean {
  return [params.uploadedFilePaths, params.images, params.uploadedImages]
    .some(value => Array.isArray(value) && value.length > 0)
}

/** 4K 只在 Pro 的非组图文生图开放；条件不满足时裁掉 4K，已选 4K 退回默认 2K。 */
const wan27FourKAllowed = (params: Record<string, unknown>) =>
  params.apimartWan27ImageVariant === 'pro' && params.apimartWan27ImageSequential !== true && !hasUploadedImage(params)
const wan27Triggers = ['apimartWan27ImageVariant', 'apimartWan27ImageSequential', 'uploadedImages', 'images']

const wan27Linkages: Linkage[] = [
  {
    trigger: wan27Triggers, effect: 'filterOptions', target: 'apimartWan27ImageResolution',
    filter: (_value, options, params) => wan27FourKAllowed(params) ? options : options.filter(option => option.value !== '4K'),
  },
  {
    trigger: wan27Triggers, effect: 'reset', targets: ['apimartWan27ImageResolution'],
    condition: (_value, params) => params.apimartWan27ImageResolution === '4K' && !wan27FourKAllowed(params),
  },
  {
    trigger: 'apimartWan27ImageSequential', effect: 'filterRange', target: 'apimartWan27ImageCount',
    filter: value => ({ min: 1, max: value === true ? 12 : 4, step: 1 }),
  },
  {
    trigger: 'apimartWan27ImageSequential', effect: 'autoSwitch', target: 'apimartWan27ImageCount',
    condition: (value, params) => value !== true && Number(params.apimartWan27ImageCount) > 4,
    value: 4, noRestore: true,
  },
]

export const apimartPresentationPart7: Record<string, ModelPresentation> = {
  'apimart-wan-2.7-image': {
    meta: meta('apimart-wan-2.7-image', 'Wan 2.7 Image'),
    params: {
      apimartWan27ImageVariant: {
        role: 'mode', name: sharedFieldText('version'),
        optionLabels: labels(['standard', 'pro'], { standard: sharedOptionText('standard'), pro: sharedOptionText('pro') }),
        tooltip: { zh: 'Pro 细节更好，文生图可出 4K，单价更高。', en: 'Pro has finer detail and offers 4K for text to image at a higher price.' },
      },
      apimartWan27ImageAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: labels(['smart', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], { smart: sharedOptionText('smart') }),
        tooltip: { zh: '上传图片后，输出比例跟随最后一张图。', en: 'With uploaded images, the output follows the last image’s aspect ratio.' },
      },
      apimartWan27ImageResolution: { name: sharedFieldText('resolution'), optionLabels: labels(['1K', '2K', '4K']) },
      apimartWan27ImageCount: { name: sharedFieldText('numberOfImages') },
      apimartWan27ImageSequential: {
        name: { zh: '组图', en: 'Image Set' },
        tooltip: { zh: '一次生成内容连贯、风格一致的一组图，适合连环画和分镜，最多 12 张、最高 2K。', en: 'Generates a coherent, consistent set in one go for comics and storyboards, up to 12 images at 2K.' },
      },
    },
    linkages: wan27Linkages,
  },

  'apimart-flux-3-video': {
    meta: meta('apimart-flux-3-video', 'FLUX 3 Video'),
    params: {
      apimartFlux3VideoMode: {
        role: 'mode', name: sharedFieldText('mode'),
        optionLabels: labels(['text-image-to-video', 'extend'], { 'text-image-to-video': sharedModeText('textImageToVideo'), extend: sharedModeText('videoExtension') }),
        tooltip: { zh: '文/图生视频：1 张图为首帧，2 张为首尾帧，3–10 张时首尾为起止、中间均匀分布。视频续写接在 1 段视频之后，单价更高。', en: 'Text/Image to Video: 1 image is the first frame, 2 are first and last, 3–10 spread evenly between them. Extension continues one video at a higher price.' },
      },
      apimartFlux3VideoAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: labels(['smart', '21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16'], { smart: sharedOptionText('smart') }),
      },
      apimartFlux3VideoResolution: {
        name: sharedFieldText('resolution'), optionLabels: labels(['hd', 'fhd'], { hd: '720p', fhd: '1080p' }),
        tooltip: { zh: '开启草稿时，草稿固定 720P，这里是转正片时的分辨率。', en: 'With Draft on, the draft is always 720P and this is the resolution of the final render.' },
      },
      apimartFlux3VideoDuration: { name: sharedFieldText('duration') },
      apimartFlux3VideoAudio: {
        name: sharedFieldText('generateAudio'),
        tooltip: { zh: '关闭后出无声视频，价格不变。', en: 'Turning it off gives a silent video at the same price.' },
      },
      apimartFlux3VideoDraft: {
        name: { zh: '草稿', en: 'Draft' },
        tooltip: { zh: '先以约 1/3 的价格出 720P 低质预览，满意后再转成正片；转正片按正片全价另计，草稿费用不抵扣。', en: 'Renders a low-quality 720P preview at about a third of the price; turn it into the final video later at the full price, with the draft cost not deducted.' },
        description: { zh: '开启后先出低价草稿，结果可一键转正片（沿用草稿的提示词、时长与素材）', en: 'Renders a cheap draft first; the result can be finalized later, keeping its prompt, duration and media' },
      },
    },
    linkages: [],
  },
}
