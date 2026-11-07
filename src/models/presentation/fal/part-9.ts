/** Fal 模型展示补丁（第 9 组：2026-11 新一代视频、图片模型）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { Linkage } from '@/core/types/Linkage'
import type { ModelPresentation, ParamOptionPresentation, ParamPresentationEntry } from '@/core/types/ModelPresentation'
import { falPresentationPart1 } from './part-1'
import { kling40ElementsPresentation, kling40ShotsPresentation } from '../kling-4.0'

type Labels = Record<string, ParamOptionPresentation>

const plain = (values: Array<string | number>, suffix = ''): Labels =>
  Object.fromEntries(values.map((value) => [String(value), { label: `${value}${suffix}` }]))

const smartRatios = (values: string[]): Labels => ({ smart: { label: sharedOptionText('smart') }, ...plain(values) })

const meta = (id: string, fallback: string): ModelPresentation['meta'] => ({
  name: { key: 'meta.name', fallback },
  i18nScope: `models.defs.${id}`,
})

const aspectRatio = (values: string[]): ParamPresentationEntry => ({ name: sharedFieldText('aspectRatio'), optionLabels: smartRatios(values) })
const resolution = (values: string[]): ParamPresentationEntry => ({ name: sharedFieldText('resolution'), optionLabels: plain(values) })
const duration: ParamPresentationEntry = { name: sharedFieldText('duration') }

const textImageMode = { label: sharedModeText('textImageToVideo'), description: { zh: '不传图为文生视频，1 张图作首帧，2 张图作首尾帧', en: 'No image for text to video, one image as the first frame, two as first and last frames' } }
const referenceMode = { label: sharedModeText('referenceToVideo') }
const videoEditMode = { label: sharedModeText('videoEdit') }
const videoExtensionMode = { label: sharedModeText('videoExtension') }

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

const ltxLongDurationAllowed = (params: Record<string, unknown>) =>
  params.falLtx23FastMode !== false && (params.falLtx23Resolution ?? '1080p') === '1080p' && Number(params.falLtx23Fps ?? 25) === 25

export const falPresentationPart9: Record<string, ModelPresentation> = {
  'fal-ai-ltx-2.3': {
    meta: meta('fal-ai-ltx-2.3', 'LTX 2.3'),
    params: {
      falLtx23Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': textImageMode,
          'video-extension': videoExtensionMode,
          'retake-video': { label: sharedModeText('retakeVideo'), description: { zh: '重新生成视频中的一段，可只换画面或只换声音', en: 'Regenerate a section of the video, optionally only its picture or sound' } },
          'audio-to-video': { label: { zh: '音频生视频', en: 'Audio to Video' }, description: { zh: '按 2–20 秒的音频生成等长、同步的画面；可再传 1 张图作首帧，不传图时需要提示词', en: 'Generate visuals synced to a 2–20 second audio clip of the same length; optionally add one image as the first frame, otherwise a prompt is required' } },
        },
      },
      falLtx23AspectRatio: aspectRatio(['16:9', '9:16']),
      falLtx23Resolution: resolution(['1080p', '1440p', '2160p']),
      falLtx23Duration: {
        name: sharedFieldText('duration'), optionLabels: plain([6, 8, 10, 12, 14, 16, 18, 20], 's'),
        tooltip: { zh: '超过 10 秒需要开启快速模式，并使用 1080p 与 25 FPS。', en: 'Durations over 10 seconds require Fast Mode, 1080p and 25 FPS.' },
      },
      falLtx23ExtendDuration: { name: { zh: '延长时长', en: 'Extension Length' } },
      falLtx23ExtendDirection: {
        name: { zh: '延长位置', en: 'Extend From' },
        optionLabels: { end: { label: { zh: '接在结尾', en: 'After the end' } }, start: { label: { zh: '加在开头', en: 'Before the start' } } },
      },
      falLtx23RetakeStartTime: { name: sharedFieldText('startTime') },
      falLtx23RetakeDuration: { name: sharedFieldText('retakeDuration') },
      falLtx23RetakeMode: {
        name: sharedFieldText('retakeMode'),
        optionLabels: {
          replace_audio_and_video: { label: sharedOptionText('replaceAudioAndVideo') },
          replace_video: { label: sharedOptionText('replaceVideo') },
          replace_audio: { label: sharedOptionText('replaceAudio') },
        },
      },
      falLtx23Fps: { name: sharedFieldText('fps'), optionLabels: plain([24, 25, 48, 50], ' FPS') },
      falLtx23GenerateAudio: { name: sharedFieldText('generateAudio') },
      falLtx23FastMode: {
        name: sharedFieldText('fastMode'),
        tooltip: { zh: '快速模式更便宜，并支持最长 20 秒；关闭后使用 Pro 画质。', en: 'Fast Mode is cheaper and allows up to 20 seconds; turn it off for Pro quality.' },
      },
    },
    linkages: withResets([{
      trigger: ['falLtx23FastMode', 'falLtx23Resolution', 'falLtx23Fps'], effect: 'filterOptions', target: 'falLtx23Duration',
      filter: (_value, options, params) => ltxLongDurationAllowed(params) ? options : options.filter((option) => Number(option.value) <= 10),
    }]),
  },
  'fal-ai-kling-4.0': {
    meta: meta('fal-ai-kling-4.0', 'Kling 4.0'),
    params: {
      falKling40Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo'), description: { zh: '第 1 张图作首帧，最后一张作尾帧，中间的按顺序作关键帧', en: 'First image opens, last image closes, images in between become ordered keyframes' } },
          'reference-to-video': referenceMode,
          'video-edit': { label: sharedModeText('videoEdit'), description: { zh: '第 1 个视频是要修改的视频，其余作参考', en: 'The first video is edited; the rest are references' } },
        },
      },
      falKling40AspectRatio: aspectRatio(['16:9', '9:16', '1:1', '21:9']),
      falKling40Resolution: resolution(['720p', '1080p']),
      falKling40Duration: duration,
      falKling40Shots: kling40ShotsPresentation,
      falKling40Elements: kling40ElementsPresentation('indexed'),
    },
    linkages: [],
  },
  'fal-ai-kling-4.0-flash': {
    meta: meta('fal-ai-kling-4.0-flash', 'Kling 4.0 Flash'),
    params: {
      falKling40FlashMode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo'), description: { zh: '不传图为文生视频，1 张图作首帧', en: 'No image for text to video, one image as the first frame' } },
          'reference-to-video': referenceMode,
          'video-edit': { label: sharedModeText('videoEdit'), description: { zh: '第 1 个视频是要修改的视频，其余作参考', en: 'The first video is edited; the rest are references' } },
        },
      },
      falKling40FlashAspectRatio: aspectRatio(['16:9', '9:16', '1:1', '21:9']),
      falKling40FlashDuration: duration,
      falKling40FlashElements: kling40ElementsPresentation('indexed'),
    },
    linkages: [],
  },
  'fal-ai-wan-3.0': {
    meta: meta('fal-ai-wan-3.0', 'Wan 3.0'),
    params: {
      falWan30Version: {
        name: sharedFieldText('version'), role: 'mode',
        optionLabels: { standard: { label: sharedOptionText('standard') }, prime: { label: 'Prime' } },
        tooltip: { zh: 'Prime 能力与标准版相同、出片更快，单价约为标准版的 1.4 倍。', en: 'Prime has the same capability and renders faster, at about 1.4× the standard price.' },
      },
      falWan30Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: { 'text-image-to-video': textImageMode, 'reference-to-video': { label: sharedModeText('referenceToVideo'), description: { zh: '最多 10 张图、5 段视频、5 段音频作参考', en: 'Up to 10 images, 5 videos and 5 audio clips as references' } } },
      },
      falWan30AspectRatio: aspectRatio(['16:9', '4:3', '1:1', '3:4', '9:16']),
      falWan30Resolution: resolution(['480p', '720p', '1080p']),
      falWan30Duration: duration,
      falWan30GenerateAudio: { name: sharedFieldText('generateAudio') },
      falWan30PromptExpansion: {
        name: sharedFieldText('promptExpansion'),
        tooltip: { zh: '关闭可快 20–60 秒，但画面质量通常会下降。', en: 'Turning it off saves 20–60 seconds but usually lowers quality.' },
      },
      falWan30Thinking: { name: { zh: '深度思考', en: 'Thinking' }, tooltip: { zh: '生成前先推理画面安排，耗时更长。', en: 'Reasons about the shot before generating; takes longer.' } },
    },
    linkages: [],
  },
  'fal-ai-gpt-image-2.6': {
    meta: meta('fal-ai-gpt-image-2.6', 'GPT Image 2.6'),
    params: {
      falGptImage26Variant: {
        name: sharedFieldText('version'), role: 'mode',
        optionLabels: { flare: { label: 'Flare' }, sunburst: { label: 'Sunburst' } },
        tooltip: { zh: 'Flare 适合快速迭代，Sunburst 侧重精细编辑。', en: 'Flare favors fast iteration; Sunburst prioritizes precise editing.' },
      },
      falGptImage26AspectRatio: aspectRatio(['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3']),
      falGptImage26Resolution: resolution(['1K', '2K', '4K']),
      falGptImage26Quality: {
        name: sharedFieldText('quality'),
        optionLabels: {
          auto: { label: sharedOptionText('auto') }, low: { label: { zh: '低', en: 'Low' } },
          medium: { label: { zh: '标准', en: 'Medium' } }, high: { label: { zh: '高', en: 'High' } },
          xhigh: { label: { zh: '超高', en: 'Extra high' } }, max: { label: { zh: '最高', en: 'Maximum' } },
        },
        tooltip: { zh: '更高质量通常增加耗时和费用；自动档的实际费用由模型选择的质量决定。', en: 'Higher quality usually increases latency and cost. Auto pricing depends on the quality selected by the model.' },
      },
      falGptImage26ReasoningEffort: {
        name: { zh: '构思深度', en: 'Reasoning Effort' },
        optionLabels: { low: { label: { zh: '低', en: 'Low' } }, medium: { label: { zh: '中', en: 'Medium' } }, high: { label: { zh: '高', en: 'High' } } },
        tooltip: { zh: '出图前的规划程度，独立于画质；密集文字和复杂版式用高档更稳，但更慢。', en: 'How much the model plans before rendering, independent of quality. Higher helps dense text and complex layouts but is slower.' },
      },
      falGptImage26Count: { name: sharedFieldText('numberOfImages') },
      falGptImage26Background: {
        name: { zh: '背景', en: 'Background' },
        optionLabels: { auto: { label: sharedOptionText('auto') }, opaque: { label: { zh: '不透明', en: 'Opaque' } }, transparent: { label: { zh: '透明', en: 'Transparent' } } },
      },
      // 复用已登记的遮罩创作契约，让生成面板与画布共同使用同一个编辑器。
      falGptImage26Mask: falPresentationPart1['fal-ai-gpt-image-2'].params.falGptImage2MaskUrl,
    },
    linkages: [],
  },
  'fal-ai-gemini-omni-1.2-flash': {
    meta: meta('fal-ai-gemini-omni-1.2-flash', 'Gemini Omni 1.2 Flash'),
    params: {
      falGeminiOmni12Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': textImageMode,
          'reference-to-video': { label: sharedModeText('referenceToVideo'), description: { zh: '最多 10 张图、3 段视频作参考', en: 'Up to 10 images and 3 videos as references' } },
          'video-edit': videoEditMode,
          'video-extension': videoExtensionMode,
        },
      },
      falGeminiOmni12AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: plain(['16:9', '9:16']) },
      falGeminiOmni12Resolution: { name: sharedFieldText('resolution'), optionLabels: { ...plain(['360p', '720p', '1080p']), '4k': { label: '4K' } } },
      falGeminiOmni12Duration: {
        ...duration,
        tooltip: { zh: '首尾帧与延长视频最长 10 秒，其余最长 15 秒。', en: 'Up to 10 seconds with an end frame or when extending; otherwise up to 15.' },
      },
    },
    linkages: [],
  },
  'fal-ai-grok-imagine-video-1.5': {
    meta: meta('fal-ai-grok-imagine-video-1.5', 'Grok Imagine Video 1.5'),
    params: {
      falGrokVideo15Version: {
        name: sharedFieldText('version'), role: 'mode',
        optionLabels: { standard: { label: sharedOptionText('standard') }, lite: { label: 'Lite' } },
        tooltip: { zh: 'Lite 更便宜，只支持文生和首帧图生视频。', en: 'Lite is cheaper and supports only text and first-frame image to video.' },
      },
      falGrokVideo15Mode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': { label: sharedModeText('textImageToVideo'), description: { zh: '不传图为文生视频，1 张图作首帧', en: 'No image for text to video, one image as the first frame' } },
          'reference-to-video': { label: sharedModeText('referenceToVideo'), description: { zh: '1–7 张参考图，最高 720p', en: '1–7 reference images, up to 720p' } },
        },
      },
      falGrokVideo15AspectRatio: aspectRatio(['16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16']),
      falGrokVideo15Resolution: resolution(['480p', '720p', '1080p']),
      falGrokVideo15Duration: duration,
    },
    linkages: withResets([{
      trigger: ['falGrokVideo15Mode', 'falGrokVideo15Version'], effect: 'filterOptions', target: 'falGrokVideo15Resolution',
      filter: (_value, options, params) => params.falGrokVideo15Version !== 'lite' && params.falGrokVideo15Mode === 'reference-to-video'
        ? options.filter((option) => option.value !== '1080p') : options,
    }]),
  },
  'fal-ai-minimax-h3-max': {
    meta: meta('fal-ai-minimax-h3-max', 'MiniMax H3 Max'),
    params: {
      falMiniMaxH3MaxVersion: {
        name: sharedFieldText('version'), role: 'mode',
        optionLabels: { max: { label: 'Max' }, turbo: { label: 'Max Turbo' } },
        tooltip: { zh: 'Turbo 生成更快、文生和图生视频半价；参考生视频与 Max 同价。', en: 'Turbo is faster and half price for text and image to video; reference to video costs the same as Max.' },
      },
      falMiniMaxH3MaxMode: {
        name: sharedFieldText('mode'), role: 'mode',
        optionLabels: {
          'text-image-to-video': textImageMode,
          'reference-to-video': { label: sharedModeText('referenceToVideo'), description: { zh: '最多 9 张图、3 段视频、3 段音频，合计不超过 12 个', en: 'Up to 9 images, 3 videos and 3 audio clips, 12 in total' } },
        },
      },
      falMiniMaxH3MaxAspectRatio: aspectRatio(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']),
      falMiniMaxH3MaxResolution: resolution(['480P', '768P', '1080P']),
      falMiniMaxH3MaxDuration: duration,
      falMiniMaxH3MaxPromptExpansion: {
        name: sharedFieldText('promptExpansion'),
        optionLabels: {
          balanced: { label: { zh: '均衡', en: 'Balanced' } },
          quality: { label: { zh: '精细', en: 'Quality' } },
          disabled: { label: sharedOptionText('disabled') },
        },
        tooltip: { zh: '精细会多花约 30 秒改写提示词，均衡约 1 秒。', en: 'Quality spends up to about 30 seconds rewriting the prompt; Balanced takes about a second.' },
      },
    },
    linkages: [],
  },
  'fal-ai-flux-3': {
    meta: meta('fal-ai-flux-3', 'FLUX 3'),
    params: {
      falFlux3AspectRatio: aspectRatio(['21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2']),
      falFlux3Resolution: {
        name: sharedFieldText('resolution'),
        optionLabels: { '768sq': { label: '768' }, '1k': { label: '1K' }, '1.5k': { label: '1.5K' }, '2k': { label: '2K' }, '4k': { label: '4K' } },
        tooltip: { zh: '4K 可能需要几分钟。', en: '4K can take several minutes.' },
      },
      falFlux3PromptExpansion: { name: sharedFieldText('promptExpansion') },
    },
    linkages: [],
  },
}
