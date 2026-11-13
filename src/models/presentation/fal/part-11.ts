/** Fal 模型展示补丁（第 11 组：Seedream 5.5、MiniMax H3 Image、PixVerse V6、LTX-2.5）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import { frameRateText } from '@/core/format/specFormat'
import type { Linkage } from '@/core/types/Linkage'
import type { ModelPresentation, ParamOptionPresentation, ParamPresentationEntry } from '@/core/types/ModelPresentation'

type Labels = Record<string, ParamOptionPresentation>

const plain = (values: Array<string | number>, suffix = ''): Labels =>
  Object.fromEntries(values.map((value) => [String(value), { label: `${value}${suffix}` }]))

const meta = (id: string, fallback: string): ModelPresentation['meta'] => ({
  name: { key: 'meta.name', fallback },
  i18nScope: `models.defs.${id}`,
})

const aspectRatio = (values: string[]): ParamPresentationEntry => ({
  name: sharedFieldText('aspectRatio'),
  optionLabels: { smart: { label: sharedOptionText('smart') }, ...plain(values) },
})

const videoResolutionLabels: Labels = {
  '360p': { label: '360P' }, '540p': { label: '540P' }, '720p': { label: '720P' },
  '1080p': { label: '1080P' }, '1440p': { label: '2K' }, '2160p': { label: '4K' },
}

/** filterOptions 只裁剪菜单不改已选值；已选值被裁掉时恢复默认值。 */
function withResets(linkages: Linkage[]): Linkage[] {
  const resets = linkages.flatMap((linkage): Linkage[] => linkage.effect === 'filterOptions' ? [{
    trigger: linkage.trigger, effect: 'reset', targets: [linkage.target],
    condition: (_value, params) => {
      const current = params[linkage.target]
      if (current === undefined) return false
      const trigger = Array.isArray(linkage.trigger) ? linkage.trigger[0] : linkage.trigger
      return linkage.filter(params[trigger], [{ value: current, label: String(current) }], params).length === 0
    },
  }] : [])
  return [...linkages, ...resets]
}

const ltx25Pro = (params: Record<string, unknown>) => params.falLtx25FastMode === false
const ltx25LongDurationAllowed = (params: Record<string, unknown>) =>
  !ltx25Pro(params) && ['720p', '1080p'].includes(String(params.falLtx25Resolution ?? '1080p')) && [24, 25].includes(Number(params.falLtx25Fps ?? 25))

export const falPresentationPart11: Record<string, ModelPresentation> = {
  'fal-ai-seedream-5.5': {
    meta: meta('fal-ai-seedream-5.5', 'Seedream 5.5'),
    params: {
      falSeedream55Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          generate: { label: { zh: '生成 / 编辑', en: 'Generate / Edit' }, description: { zh: '不传图为文生图，传图后按提示词编辑或参考生成', en: 'Text to image without images; edits or references uploaded images' } },
          'layer-decomposition': { label: { zh: '图层拆分', en: 'Layer Decomposition' }, description: { zh: '把 1 张图拆成底图和最多 16 个透明图层，提示词可指定要拆出的元素', en: 'Splits one image into a base and up to 16 transparent layers; the prompt can name elements to separate' } },
        },
      },
      falSeedream55AspectRatio: aspectRatio(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']),
      falSeedream55Resolution: { name: sharedFieldText('resolution'), optionLabels: plain(['1K', '1.5K', '2K']) },
      falSeedream55LayerSize: {
        name: sharedFieldText('resolution'),
        optionLabels: { auto: { label: sharedOptionText('auto') }, ...plain(['1K', '1.5K', '2K']) },
      },
      falSeedream55NumImages: { name: sharedFieldText('numberOfImages') },
      falSeedream55Background: {
        name: { zh: '背景', en: 'Background' },
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          opaque: { label: { zh: '不透明', en: 'Opaque' } },
          transparent: { label: { zh: '透明', en: 'Transparent' } },
        },
        description: { zh: '透明直接输出带透明通道的 PNG，文生图也可用；自动由模型按提示词判断', en: 'Transparent outputs PNG with alpha, including text to image; auto lets the model decide from the prompt' },
      },
    },
    linkages: [],
  },
  'fal-ai-minimax-h3-image': {
    meta: meta('fal-ai-minimax-h3-image', 'MiniMax H3 Image'),
    params: {
      falMiniMaxH3ImageVersion: {
        name: sharedFieldText('version'), role: 'mode',
        optionLabels: { standard: { label: sharedOptionText('standard') }, highspeed: { label: 'Highspeed' } },
        tooltip: { zh: 'Highspeed 出图更快，输出图片的单价是标准版的 2 倍。', en: 'Highspeed is faster; its output image price is twice the standard rate.' },
      },
      falMiniMaxH3ImageAspectRatio: aspectRatio(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']),
      falMiniMaxH3ImageResolution: { name: sharedFieldText('resolution'), optionLabels: plain(['1K', '2K', '4K']) },
      falMiniMaxH3ImageNumImages: { name: sharedFieldText('numberOfImages') },
      falMiniMaxH3ImagePromptExpansion: {
        name: sharedFieldText('promptExpansion'),
        tooltip: { zh: '先把提示词扩写成详细描述再出图；编辑参考图时始终开启。', en: 'Rewrites the prompt into a detailed description first; always on when editing images.' },
      },
    },
    linkages: [],
  },
  'fal-ai-pixverse-v6': {
    meta: meta('fal-ai-pixverse-v6', 'PixVerse V6'),
    params: {
      falPixverseV6Version: {
        name: sharedFieldText('version'), role: 'mode',
        optionLabels: { standard: { label: sharedOptionText('standard') }, max: { label: 'Max' } },
        tooltip: { zh: 'Max 画质更好，价格约为标准版的 2 倍，只支持文生和单张首帧图生视频。', en: 'Max has better quality at about twice the price, and only supports text and single first-frame image to video.' },
      },
      falPixverseV6Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo'), description: { zh: '不传图为文生视频，1 张图作首帧，2 张图作首尾帧', en: 'No image for text to video, one image as the first frame, two as first and last frames' } },
          'video-extension': { label: sharedModeText('videoExtension'), description: { zh: '接在 1 段视频后继续生成', en: 'Continues after one video clip' } },
        },
      },
      falPixverseV6AspectRatio: aspectRatio(['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9']),
      falPixverseV6Resolution: { name: sharedFieldText('resolution'), optionLabels: videoResolutionLabels },
      falPixverseV6Duration: { name: sharedFieldText('duration') },
      falPixverseV6Style: {
        name: sharedFieldText('style'),
        optionLabels: {
          none: { label: sharedOptionText('default') },
          anime: { label: sharedOptionText('anime') },
          '3d_animation': { label: sharedOptionText('threeDAnimation') },
          clay: { label: sharedOptionText('clay') },
          comic: { label: sharedOptionText('comic') },
          cyberpunk: { label: sharedOptionText('cyberpunk') },
        },
      },
      falPixverseV6ThinkingType: {
        name: sharedFieldText('thinkingType'),
        optionLabels: {
          auto: { label: sharedOptionText('auto') },
          enabled: { label: sharedOptionText('enabled') },
          disabled: { label: sharedOptionText('disabled') },
        },
      },
      falPixverseV6GenerateAudio: { name: sharedFieldText('generateAudio') },
      falPixverseV6MultiClip: { name: sharedFieldText('multiClip') },
    },
    linkages: [],
  },
  'fal-ai-ltx-2.5': {
    meta: meta('fal-ai-ltx-2.5', 'LTX 2.5'),
    params: {
      falLtx25Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo'), description: { zh: '不传图为文生视频，1 张图作首帧，2 张图作首尾帧', en: 'No image for text to video, one image as the first frame, two as first and last frames' } },
          'audio-to-video': { label: { zh: '音频生视频', en: 'Audio to Video' }, description: { zh: '按 2–20 秒的音频生成等长、同步的画面（关闭快速模式时最长 10 秒）；可再传 1 张图作首帧，不传图时需要提示词', en: 'Generate visuals synced to a 2–20 second audio clip of the same length (10 seconds max with Fast Mode off); optionally add one image as the first frame, otherwise a prompt is required' } },
        },
      },
      falLtx25AspectRatio: aspectRatio(['16:9', '9:16']),
      falLtx25Resolution: { name: sharedFieldText('resolution'), optionLabels: videoResolutionLabels },
      falLtx25Duration: {
        name: sharedFieldText('duration'), optionLabels: plain([6, 8, 10, 12, 14, 16, 18, 20], 's'),
        tooltip: { zh: '超过 10 秒需要开启快速模式，并使用 720P 或 1080P、24 或 25 帧/秒。', en: 'Durations over 10 seconds require Fast Mode, 720P or 1080P, and 24 or 25fps.' },
      },
      falLtx25Fps: { name: sharedFieldText('fps'), optionLabels: Object.fromEntries([24, 25, 48, 50].map(fps => [String(fps), { label: frameRateText(fps) }])) },
      falLtx25GenerateAudio: { name: sharedFieldText('generateAudio') },
      falLtx25FastMode: {
        name: sharedFieldText('fastMode'),
        tooltip: { zh: '快速模式更便宜，支持 2K、4K 和最长 20 秒；关闭后使用 Pro 画质，最高 1080P、10 秒。', en: 'Fast Mode is cheaper and supports 2K, 4K and up to 20 seconds; turn it off for Pro quality, up to 1080P and 10 seconds.' },
      },
      falLtx25CameraMotion: {
        name: { zh: '镜头运动', en: 'Camera Motion' },
        optionLabels: {
          none: { label: sharedOptionText('auto') },
          dolly_in: { label: { zh: '推近', en: 'Dolly In' } },
          dolly_out: { label: { zh: '拉远', en: 'Dolly Out' } },
          dolly_left: { label: { zh: '左移', en: 'Dolly Left' } },
          dolly_right: { label: { zh: '右移', en: 'Dolly Right' } },
          jib_up: { label: { zh: '升镜', en: 'Jib Up' } },
          jib_down: { label: { zh: '降镜', en: 'Jib Down' } },
          static: { label: { zh: '固定', en: 'Static' } },
          focus_shift: { label: { zh: '转焦', en: 'Focus Shift' } },
        },
        description: { zh: '给整段视频指定一种镜头运动；自动表示不指定，由提示词和模型决定', en: 'Applies one camera move to the whole clip; auto leaves it to the prompt and model' },
      },
    },
    linkages: withResets([
      {
        trigger: 'falLtx25FastMode', effect: 'filterOptions', target: 'falLtx25Resolution',
        filter: (_value, options, params) => ltx25Pro(params) ? options.filter((option) => option.value === '720p' || option.value === '1080p') : options,
      },
      {
        trigger: 'falLtx25FastMode', effect: 'filterOptions', target: 'falLtx25Fps',
        filter: (_value, options, params) => ltx25Pro(params) ? options.filter((option) => Number(option.value) !== 48) : options,
      },
      {
        trigger: ['falLtx25FastMode', 'falLtx25Resolution', 'falLtx25Fps'], effect: 'filterOptions', target: 'falLtx25Duration',
        filter: (_value, options, params) => ltx25LongDurationAllowed(params) ? options : options.filter((option) => Number(option.value) <= 10),
      },
    ]),
  },
}
