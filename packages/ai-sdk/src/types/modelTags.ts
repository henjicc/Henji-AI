/**
 * 生成模型能力标签词表：标签只回答“这个模型能做什么事”，一件事只有一个标签。
 *
 * 两层判断标准：
 * - 形态（form）：按“输入什么、输出什么”判断，模型能做就打。
 * - 专项（specialty）：模型为这件事提供了专门的参数或接口才打；通用编辑模型只靠写提示词也能做到的不打。
 *
 * 能从模型配置读出的事实（供应商、类型、能传几张图、分辨率档位、出图数量、提示词语言）不做标签。
 * 展示名属于宿主的产品文案，不放在 SDK。
 */
export const MODEL_TAG_DEFINITIONS = [
  { id: 'text-to-image', layer: 'form', mediaType: 'image', criterion: '不给图，只凭文字出图' },
  { id: 'image-to-image', layer: 'form', mediaType: 'image', criterion: '给图，按提示词改图或据此生成新图（参考、融合也算）' },
  { id: 'text-to-video', layer: 'form', mediaType: 'video', criterion: '不给图或视频，只凭文字出视频' },
  { id: 'image-to-video', layer: 'form', mediaType: 'video', criterion: '给一张图作首帧生成视频' },
  { id: 'start-end-frame', layer: 'form', mediaType: 'video', criterion: '同时给首帧和尾帧生成中间过程；必须同时具备图生视频' },
  { id: 'reference-mode', layer: 'form', mediaType: 'video', criterion: '图片或视频只作参考生成新片段，不锁定首帧，也不保证在原视频上改或接在其后' },
  { id: 'video-to-video', layer: 'form', mediaType: 'video', criterion: '输入一段视频，在原时间轴上改内容' },
  { id: 'video-extension', layer: 'form', mediaType: 'video', criterion: '接在输入视频之后继续生成' },
  { id: 'motion-control', layer: 'form', mediaType: 'video', criterion: '用一段视频的动作驱动图里的主体' },
  { id: 'audio-to-video', layer: 'form', mediaType: 'video', criterion: '输入一段音频，生成与之同步、等长的视频' },
  { id: 'text-to-audio', layer: 'form', mediaType: 'audio', criterion: '文字转语音' },
  { id: 'voice-clone', layer: 'form', mediaType: 'audio', criterion: '用一段声音生成可复用的音色' },
  { id: 'inpainting', layer: 'specialty', mediaType: 'image', criterion: '有遮罩输入，按提示词只改遮罩内的区域' },
  { id: 'erase', layer: 'specialty', mediaType: 'image', criterion: '有遮罩输入，不需要提示词，把遮罩内的东西去掉' },
  { id: 'relighting', layer: 'specialty', mediaType: 'image', criterion: '有光源方向、强度或光照预设等专门参数' },
  { id: 'multi-angle', layer: 'specialty', mediaType: 'image', criterion: '有镜头角度、视角预设等专门参数' },
  { id: 'outpainting', layer: 'specialty', mediaType: 'image', criterion: '有扩展方向、边距等专门参数' },
  { id: 'upscaling', layer: 'specialty', mediaType: 'image', criterion: '专门提高分辨率，有放大倍数或目标尺寸参数' },
  { id: 'photo-restoration', layer: 'specialty', mediaType: 'image', criterion: '专门修复老照片的划痕、褪色、模糊' },
  { id: 'layer-decomposition', layer: 'specialty', mediaType: 'image', criterion: '把一张图拆成多张分层图' },
  { id: 'animated-image', layer: 'specialty', mediaType: 'image', criterion: '能直接输出 GIF 等动图（有输出格式或帧数参数）' },
  { id: 'vector-image', layer: 'specialty', mediaType: 'image', criterion: '能直接输出 SVG 等矢量图（有输出格式参数）' },
  { id: 'transparent-background', layer: 'specialty', mediaType: 'image', criterion: '能输出带透明通道的图（抠图、保留透明、透明背景参数）' },
  { id: 'low-light-enhancement', layer: 'specialty', mediaType: 'image', criterion: '专门提亮暗光照片' },
  { id: 'product-photography', layer: 'specialty', mediaType: 'image', criterion: '专门给商品图生成新的背景与场景' },
  { id: 'multi-speaker-dialogue', layer: 'specialty', mediaType: 'audio', criterion: '一段脚本里多个说话人，一次合成整段对话' },
  { id: 'timestamps', layer: 'specialty', mediaType: 'audio', criterion: '合成结果附带逐字或逐词的时间' },
] as const satisfies readonly {
  id: string
  layer: 'form' | 'specialty'
  mediaType: 'image' | 'video' | 'audio'
  criterion: string
}[]

export type ModelTagDefinition = (typeof MODEL_TAG_DEFINITIONS)[number]
export type ModelTag = ModelTagDefinition['id']
export type ModelTagLayer = ModelTagDefinition['layer']

export const MODEL_TAGS: readonly ModelTag[] = MODEL_TAG_DEFINITIONS.map((definition) => definition.id)

export function isModelTag(value: string): value is ModelTag {
  return (MODEL_TAGS as readonly string[]).includes(value)
}

export function getModelTagDefinition(tag: ModelTag): ModelTagDefinition {
  return MODEL_TAG_DEFINITIONS.find((definition) => definition.id === tag)!
}
