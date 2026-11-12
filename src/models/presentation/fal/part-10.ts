/** Fal 模型展示补丁（第 10 组：FLUX 3 Video）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { Linkage } from '@/core/types/Linkage'
import type { ModelPresentation, ParamOptionPresentation } from '@/core/types/ModelPresentation'

const plain = (values: string[], named: Record<string, string> = {}): Record<string, ParamOptionPresentation> =>
  Object.fromEntries(values.map(value => [value, { label: named[value] ?? value }]))

/** 续写与 Max 只公布了 720p/1080p 的价格，只开放这两档。 */
const highTiersAllowed = (params: Record<string, unknown>) =>
  params.falFlux3VideoVersion !== 'max' && params.falFlux3VideoMode !== 'extend'
const resolutionTriggers = ['falFlux3VideoVersion', 'falFlux3VideoMode']

const linkages: Linkage[] = [
  {
    trigger: resolutionTriggers, effect: 'filterOptions', target: 'falFlux3VideoResolution',
    filter: (_value, options, params) => highTiersAllowed(params) ? options : options.filter(option => option.value === '720p' || option.value === '1080p'),
  },
  {
    trigger: resolutionTriggers, effect: 'reset', targets: ['falFlux3VideoResolution'],
    condition: (_value, params) => !highTiersAllowed(params) && !['720p', '1080p'].includes(String(params.falFlux3VideoResolution ?? '720p')),
  },
]

export const falPresentationPart10: Record<string, ModelPresentation> = {
  'fal-flux-3-video': {
    meta: { name: { key: 'meta.name', fallback: 'FLUX 3 Video' }, i18nScope: 'models.defs.fal-flux-3-video' },
    params: {
      falFlux3VideoVersion: {
        name: sharedFieldText('version'), role: 'mode',
        optionLabels: { standard: { label: sharedOptionText('standard') }, max: { label: 'Max' } },
        tooltip: { zh: 'Max 是 Fal 后训练的增强版，提示词遵循和画质更好，支持首尾帧，但只能文生和图生视频，最高 1080P。', en: 'Max is Fal’s post-trained variant with better prompt adherence and quality and first-last frames, limited to text and image to video up to 1080P.' },
      },
      falFlux3VideoMode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo'), description: { zh: '不传图为文生视频，1 张图作首帧', en: 'No image for text to video, one image as the first frame' } },
          extend: { label: sharedModeText('videoExtension'), description: { zh: '接在 1 段 15 秒内的视频后继续生成，最高 1080P', en: 'Continues one clip under 15 s, up to 1080P' } },
          edit: { label: sharedModeText('videoEdit'), description: { zh: '按提示词重绘 1 段 15 秒内的视频，保留动作与构图，720P', en: 'Re-renders one clip under 15 s from the prompt, keeping motion and framing, at 720P' } },
        },
      },
      falFlux3VideoAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: { smart: { label: sharedOptionText('smart') }, ...plain(['21:9', '2:1', '16:9', '4:3', '1:1', '3:4', '9:16']) },
      },
      falFlux3VideoResolution: { name: sharedFieldText('resolution'), optionLabels: plain(['720p', '1080p', '1440p', '2160p'], { '1440p': '2K', '2160p': '4K' }) },
      falFlux3VideoDuration: { name: sharedFieldText('duration') },
      falFlux3VideoGenerateAudio: { name: sharedFieldText('generateAudio') },
      falFlux3VideoDraft: {
        name: { zh: '草稿', en: 'Draft' },
        tooltip: { zh: '先以约 1/3 的价格出 720P 低质预览，满意后再转成 1080P 正片；转正片按 $0.29/秒另计。', en: 'Renders a low-quality 720P preview at about a third of the price; turn it into a 1080P final later at $0.29/s.' },
        description: { zh: '开启后先出低价草稿，结果可一键转成 1080P 正片（沿用草稿的提示词、时长、素材与种子）', en: 'Renders a cheap draft first; the result can be finalized to 1080P, keeping its prompt, duration, media and seed' },
      },
      falFlux3VideoReasoning: {
        name: { zh: '推理强度', en: 'Reasoning' },
        optionLabels: { low: { label: sharedOptionText('low') }, high: { label: sharedOptionText('high') } },
        tooltip: { zh: '高推理更贴合提示词，但生成更慢。', en: 'High reasoning follows the prompt more closely but generates more slowly.' },
      },
    },
    linkages,
  },
}
