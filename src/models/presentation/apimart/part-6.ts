/** apimart 模型展示补丁（第 6 组：GPT Image 2.6、Kling V4、Gemini Omni 1.2 Flash、Wan 3.0 等）。 */

import { sharedFieldText, sharedModeText, sharedOptionText } from '@/core/i18n/modelText'
import type { I18nText } from '@/core/types/I18nText'
import type { Linkage } from '@/core/types/Linkage'
import type { ModelPresentation, ParamOptionPresentation } from '@/core/types/ModelPresentation'

const labels = (values: readonly string[], named: Record<string, I18nText> = {}): Record<string, ParamOptionPresentation> =>
  Object.fromEntries(values.map(value => [value, { label: named[value] ?? value }]))

const meta = (id: string, fallback: string) => ({ name: { key: 'meta.name', fallback }, i18nScope: `models.defs.${id}` })
const channel = (named: Record<string, I18nText>) => ({ role: 'channel' as const, name: sharedFieldText('apiChannel'), optionLabels: labels(Object.keys(named), named) })
const ext = { ext: 'Ext', official: sharedOptionText('official') }
const keepSound: I18nText = { zh: '保留视频原声', en: 'Keep Original Sound' }
const videoModes = {
  'text-image-to-video': sharedModeText('textImageToVideo'),
  'reference-to-video': sharedModeText('referenceToVideo'),
  edit: sharedModeText('videoEdit'),
  extend: sharedModeText('videoExtension'),
}

/** filterOptions 只裁剪菜单，不改已选值；当前值被裁掉时同步回到默认值。 */
function withResets(linkages: Linkage[]): Linkage[] {
  const resets = linkages.flatMap(linkage => linkage.effect === 'filterOptions' ? [{
    trigger: linkage.trigger, effect: 'reset' as const, targets: [linkage.target],
    condition: (_value: DynamicValue, params: DynamicValueMap) => {
      const current = params[linkage.target]
      if (current === undefined) return false
      const trigger = Array.isArray(linkage.trigger) ? linkage.trigger[0] : linkage.trigger
      return linkage.filter(params[trigger], [{ value: String(current), label: String(current) }], params).length === 0
    },
  }] : [])
  return [...linkages, ...resets]
}

const gpt26ExtRatios = ['smart', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9']
const gpt26Ratios = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '21:9', '9:21', '3:1', '1:3']
const grokExtRatios = ['smart', '16:9', '9:16', '1:1', '3:2', '2:3']

export const apimartPresentationPart6: Record<string, ModelPresentation> = {
  'apimart-gpt-image-2.6': {
    meta: meta('apimart-gpt-image-2.6', 'GPT Image 2.6'),
    params: {
      gpt26Channel: channel(ext),
      gpt26Variant: {
        role: 'mode', name: { zh: '版本', en: 'Version' },
        optionLabels: labels(['flare', 'sunburst'], { flare: 'Flare', sunburst: 'Sunburst' }),
        tooltip: { zh: 'Flare 速度优先，适合快速迭代；Sunburst 细节与编辑一致性优先。两者价格相同。', en: 'Flare favors speed for fast iteration; Sunburst favors detail and editing consistency. Both cost the same.' },
      },
      gpt26AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', ...gpt26Ratios], { smart: sharedOptionText('smart') }) },
      gpt26Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['1K', '2K', '4K']) },
      gpt26Quality: {
        name: sharedFieldText('quality'),
        optionLabels: labels(['auto', 'low', 'medium', 'high', 'xhigh', 'max'], {
          auto: sharedOptionText('auto'), low: { zh: '低', en: 'Low' }, medium: { zh: '标准', en: 'Medium' },
          high: { zh: '高', en: 'High' }, xhigh: { zh: '超高', en: 'Extra high' }, max: { zh: '最高', en: 'Maximum' },
        }),
        tooltip: { zh: '官方渠道质量越高费用越高，自动档按最高档预扣；Ext 渠道质量不影响价格，只影响耗时。', en: 'On the official channel higher quality costs more and Auto reserves the maximum tier; on Ext quality only affects latency.' },
      },
      gpt26Complexity: {
        name: { zh: '规划强度', en: 'Planning' },
        optionLabels: labels(['low', 'medium', 'high'], { low: { zh: '低', en: 'Low' }, medium: { zh: '中', en: 'Medium' }, high: { zh: '高', en: 'High' } }),
        tooltip: { zh: '与画质独立、不额外收费。局部小改动用低；密集文字、复杂版式用高，但可能更慢或带来额外改动。', en: 'Independent of quality and free. Use Low for small edits; High suits dense text and complex layouts but may be slower or change more.' },
      },
      gpt26Count: { name: sharedFieldText('numberOfImages') },
      gpt26Background: {
        name: { zh: '背景', en: 'Background' },
        optionLabels: labels(['auto', 'opaque', 'transparent'], { auto: sharedOptionText('auto'), opaque: { zh: '不透明', en: 'Opaque' }, transparent: { zh: '透明', en: 'Transparent' } }),
      },
    },
    linkages: withResets([{
      trigger: 'gpt26Channel', effect: 'filterOptions', target: 'gpt26AspectRatio',
      filter: (value, options) => options.filter(option => value === 'official' || gpt26ExtRatios.includes(String(option.value))),
    }]),
  },

  'apimart-kling-4.0': {
    meta: meta('apimart-kling-4.0', 'Kling 4.0'),
    params: {
      apimartKlingV4Mode: {
        role: 'mode', name: sharedFieldText('mode'), optionLabels: labels(Object.keys(videoModes), videoModes),
        tooltip: { zh: '文/图生视频按图片数量自动处理：1 张为首帧，2 张为首尾帧。编辑和续写需要 1 段输入视频；所有输出都带立体声。', en: 'Text/Image to Video follows the image count: 1 image is the first frame, 2 are first and last frames. Edit and Extension need one input video. All outputs include stereo audio.' },
      },
      apimartKlingV4AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', '16:9', '9:16', '1:1', '21:9'], { smart: sharedOptionText('smart') }) },
      apimartKlingV4Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['720p', '1080p']) },
      apimartKlingV4Duration: {
        name: sharedFieldText('duration'),
        tooltip: { zh: '续写时表示新增片段的时长，只按新增秒数计费。', en: 'For Extension this is the length of the new segment, and only those seconds are billed.' },
      },
      apimartKlingV4KeepOriginalSound: { name: keepSound },
    },
    linkages: [],
  },

  'apimart-gemini-omni-1.2-flash': {
    meta: meta('apimart-gemini-omni-1.2-flash', 'Gemini Omni 1.2 Flash'),
    params: {
      apimartGeminiOmni12Channel: channel({ official: sharedOptionText('official'), ext: 'Ext' }),
      apimartGeminiOmni12Mode: {
        role: 'mode', name: sharedFieldText('mode'), optionLabels: labels(Object.keys(videoModes), videoModes),
        tooltip: { zh: '文/图生视频：1 张图为首帧，2 张为首尾帧（Ext 渠道不支持尾帧）。多图参考最多 10 张。编辑和续写需要 1 段不超过 15 秒的视频。', en: 'Text/Image to Video: 1 image is the first frame, 2 are first and last frames (Ext has no last frame). Reference takes up to 10 images. Edit and Extension need one video up to 15 seconds.' },
      },
      apimartGeminiOmni12AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['16:9', '9:16']) },
      apimartGeminiOmni12Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['360p', '720p', '1080p', '4k'], { '4k': '4K' }) },
      apimartGeminiOmni12Duration: {
        name: sharedFieldText('duration'),
        tooltip: { zh: '首尾帧和续写最长 10 秒；续写时表示新增片段时长。', en: 'First-last frame and Extension allow up to 10 seconds; for Extension this is the new segment length.' },
      },
    },
    linkages: [{
      trigger: 'apimartGeminiOmni12Mode', effect: 'filterRange', target: 'apimartGeminiOmni12Duration',
      filter: mode => ({ min: 3, max: mode === 'extend' ? 10 : 15, step: 1 }),
    }, {
      trigger: 'apimartGeminiOmni12Mode', effect: 'autoSwitch', target: 'apimartGeminiOmni12Duration',
      condition: (mode, params) => mode === 'extend' && Number(params.apimartGeminiOmni12Duration) > 10,
      value: 10, noRestore: true,
    }],
  },

  'apimart-wan-3.0': {
    meta: meta('apimart-wan-3.0', 'Wan 3.0'),
    params: {
      apimartWan30Variant: {
        role: 'mode', name: { zh: '版本', en: 'Version' },
        optionLabels: labels(['standard', 'prime'], { standard: sharedOptionText('standard'), prime: 'Prime' }),
        tooltip: { zh: 'Prime 参数相同，单价更高。', en: 'Prime takes the same parameters at a higher price.' },
      },
      apimartWan30Mode: {
        role: 'mode', name: sharedFieldText('mode'),
        optionLabels: labels(['text-image-to-video', 'reference-to-video'], videoModes),
        tooltip: { zh: '文/图生视频：1 张图为首帧，2 张为首尾帧。参考生视频可放最多 10 张图、5 段视频、5 段音频，提示词里用“图1”“视频1”“音频1”指代。', en: 'Text/Image to Video: 1 image is the first frame, 2 are first and last frames. Reference takes up to 10 images, 5 videos and 5 audio clips; refer to them as Image 1, Video 1, Audio 1 in the prompt.' },
      },
      apimartWan30AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', '16:9', '4:3', '1:1', '3:4', '9:16'], { smart: sharedOptionText('smart') }) },
      apimartWan30Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['480P', '720P', '1080P']) },
      apimartWan30Duration: {
        name: sharedFieldText('duration'),
        tooltip: { zh: '有参考视频时，输入视频总时长加输出时长不能超过 30 秒。', en: 'With reference videos, total input length plus output length cannot exceed 30 seconds.' },
      },
      apimartWan30Audio: { name: sharedFieldText('generateAudio') },
    },
    linkages: [],
  },

  'apimart-grok-imagine-video-1.5': {
    meta: meta('apimart-grok-imagine-video-1.5', 'Grok Imagine Video 1.5'),
    params: {
      apimartGrokVideo15Channel: channel({ official: sharedOptionText('official'), ext: 'Ext' }),
      apimartGrokVideo15AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', '16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], { smart: sharedOptionText('smart') }) },
      apimartGrokVideo15Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['480p', '720p', '1080p']) },
      apimartGrokVideo15Duration: { name: sharedFieldText('duration') },
    },
    linkages: [
      ...withResets([{
        trigger: 'apimartGrokVideo15Channel', effect: 'filterOptions', target: 'apimartGrokVideo15AspectRatio',
        filter: (value, options) => options.filter(option => value !== 'ext' || grokExtRatios.includes(String(option.value))),
      }, {
        trigger: 'apimartGrokVideo15Channel', effect: 'filterOptions', target: 'apimartGrokVideo15Resolution',
        filter: (value, options) => options.filter(option => value !== 'ext' || option.value !== '1080p'),
      }]),
      {
        trigger: 'apimartGrokVideo15Channel', effect: 'filterRange', target: 'apimartGrokVideo15Duration',
        filter: value => ({ min: value === 'ext' ? 6 : 1, max: 15, step: 1 }),
      },
      {
        trigger: 'apimartGrokVideo15Channel', effect: 'autoSwitch', target: 'apimartGrokVideo15Duration',
        condition: (value, params) => value === 'ext' && Number(params.apimartGrokVideo15Duration) < 6,
        value: 6, noRestore: true,
      },
    ],
  },

  'apimart-minimax-h3-max': {
    meta: meta('apimart-minimax-h3-max', 'MiniMax H3 Max'),
    params: {
      apimartMiniMaxH3MaxMode: {
        role: 'mode', name: sharedFieldText('mode'),
        optionLabels: labels(['text-image-to-video', 'reference-to-video'], videoModes),
        tooltip: { zh: '文/图生视频：1 张图为首帧，2 张为首尾帧。参考生视频可放最多 9 张图、3 段视频和 3 段音频，音频不能单独使用。', en: 'Text/Image to Video: 1 image is the first frame, 2 are first and last frames. Reference takes up to 9 images, 3 videos and 3 audio clips; audio cannot be used alone.' },
      },
      apimartMiniMaxH3MaxAspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], { smart: sharedOptionText('smart') }) },
      apimartMiniMaxH3MaxResolution: { name: sharedFieldText('resolution'), optionLabels: labels(['480P', '768P', '1080P']) },
      apimartMiniMaxH3MaxDuration: { name: sharedFieldText('duration') },
    },
    linkages: [],
  },

  'apimart-flux-3-image': {
    meta: meta('apimart-flux-3-image', 'FLUX 3 Image'),
    params: {
      apimartFlux3Variant: {
        role: 'mode', name: { zh: '版本', en: 'Version' },
        optionLabels: labels(['standard', 'klein'], { standard: sharedOptionText('standard'), klein: 'Klein' }),
        tooltip: { zh: 'Klein 是更小更快的开放权重版本，单价更低。', en: 'Klein is a smaller, faster open-weight version at a lower price.' },
      },
      apimartFlux3AspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: labels(['smart', '21:9', '2:1', '16:9', '3:2', '7:5', '4:3', '5:4', '1:1', '4:5', '3:4', '5:7', '2:3', '9:16', '1:2', '9:21'], { smart: sharedOptionText('smart') }),
      },
      apimartFlux3Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['768sq', '1k', '1.5k', '2k', '4k'], { '768sq': '768²', '1k': '1K', '1.5k': '1.5K', '2k': '2K', '4k': '4K' }) },
    },
    linkages: [],
  },

  'apimart-veo-3.1': {
    meta: meta('apimart-veo-3.1', 'Veo 3.1'),
    params: {
      apimartVeo31Channel: channel(ext),
      apimartVeo31Variant: {
        role: 'mode', name: { zh: '版本', en: 'Version' },
        optionLabels: labels(['fast', 'quality', 'lite'], { fast: 'Fast', quality: 'Quality', lite: 'Lite' }),
        tooltip: { zh: 'Ext 渠道固定 8 秒、按条计费；Lite 不支持参考图。官方渠道只有 Fast 和 Quality，可选时长与音频、按秒计费。', en: 'Ext is a fixed 8-second clip billed per clip; Lite takes no images. Official offers Fast and Quality with selectable duration and audio, billed per second.' },
      },
      apimartVeo31Mode: {
        role: 'mode', name: sharedFieldText('mode'),
        optionLabels: labels(['text-image-to-video', 'reference-to-video'], videoModes),
        tooltip: { zh: '文/图生视频：1 张图为首帧，2 张为首尾帧。参考图生视频使用 1–3 张参考图。', en: 'Text/Image to Video: 1 image is the first frame, 2 are first and last frames. Reference uses 1–3 images.' },
      },
      apimartVeo31AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['16:9', '9:16']) },
      apimartVeo31Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['720p', '1080p', '4k'], { '4k': '4K' }) },
      apimartVeo31Duration: { name: sharedFieldText('duration'), optionLabels: labels(['4', '6', '8'], Object.fromEntries(['4', '6', '8'].map(value => [value, { zh: value + ' 秒', en: value + 's' }]))) },
      apimartVeo31GenerateAudio: { name: sharedFieldText('generateAudio') },
    },
    linkages: withResets([{
      trigger: 'apimartVeo31Channel', effect: 'filterOptions', target: 'apimartVeo31Variant',
      filter: (value, options) => options.filter(option => value !== 'official' || option.value !== 'lite'),
    }]),
  },

  'apimart-seedream-5.0-flash': {
    meta: meta('apimart-seedream-5.0-flash', 'Seedream 5.0 Flash'),
    params: {
      apimartSeedream50FlashAspectRatio: {
        name: sharedFieldText('aspectRatio'),
        optionLabels: labels(['smart', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '21:9'], { smart: sharedOptionText('smart') }),
      },
      apimartSeedream50FlashResolution: {
        name: sharedFieldText('resolution'), optionLabels: labels(['1K', '1.5K', '2K']),
        tooltip: { zh: '三档同价，1.5K 画质比 1K 更好。', en: 'All tiers cost the same; 1.5K looks better than 1K.' },
      },
    },
    linkages: [],
  },

  'apimart-happyhorse-1.1': {
    meta: meta('apimart-happyhorse-1.1', 'HappyHorse 1.1'),
    params: {
      apimartHappyHorse11Mode: {
        role: 'mode', name: sharedFieldText('mode'),
        optionLabels: labels(['text-image-to-video', 'reference-to-video'], videoModes),
        tooltip: { zh: '文/图生视频：不传图为文生，1 张图作首帧。参考图生视频用 1–9 张图作主体或风格参考，生成全新画面。', en: 'Text/Image to Video: no image for text, one image as the first frame. Reference uses 1–9 images as subject or style references for a new scene.' },
      },
      apimartHappyHorse11AspectRatio: { name: sharedFieldText('aspectRatio'), optionLabels: labels(['smart', '16:9', '9:16', '1:1', '4:3', '3:4'], { smart: sharedOptionText('smart') }) },
      apimartHappyHorse11Resolution: { name: sharedFieldText('resolution'), optionLabels: labels(['720P', '1080P']) },
      apimartHappyHorse11Duration: { name: sharedFieldText('duration') },
    },
    linkages: [],
  },
}
