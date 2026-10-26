import { z } from 'zod'

/**
 * 素材面板的颜色标签（剪辑对齐 PR 3.2）：与 PR 默认标签同名的 16 种颜色。素材项、素材箱与序列可各自设置；
 * 没设置时先跟随所在素材箱（含上级箱）设过的标签，按用途分箱后同一箱的素材一个颜色（2026-10-26 用户要求，PR 没有这条）；
 * 箱也没设时按类型取默认（PR“标签默认值”：素材箱芒果黄、序列森林绿、视频鸢尾花、音频加勒比海蓝、静止图像淡紫；
 * 另有文字玫瑰红、图形洋红、代码天蓝、调整紫罗兰、字幕芒果黄，时间线片段按同一份默认上色，重要记录 019）。
 * 颜色值是内容色，登记在 `core/theme/colorTokens.ts`。
 */
export const VIDEO_EDIT_LABELS = ['violet', 'iris', 'caribbean', 'lavender', 'cerulean', 'forest', 'rose', 'mango', 'purple', 'blue', 'teal', 'magenta', 'tan', 'green', 'brown', 'yellow'] as const
export type VideoEditLabel = typeof VIDEO_EDIT_LABELS[number]
export const videoEditLabelSchema = z.enum(VIDEO_EDIT_LABELS)
export const VIDEO_EDIT_LABEL_NAMES: Record<VideoEditLabel, string> = {
  violet: '紫罗兰色', iris: '鸢尾花色', caribbean: '加勒比海蓝色', lavender: '淡紫色', cerulean: '天蓝色', forest: '森林绿色', rose: '玫瑰红色', mango: '芒果黄色',
  purple: '紫色', blue: '蓝色', teal: '深青色', magenta: '洋红色', tan: '棕黄色', green: '绿色', brown: '棕色', yellow: '黄色',
}
export type VideoEditLabelKind = 'bin' | 'sequence' | 'video' | 'audio' | 'image' | 'text' | 'code' | 'graphic' | 'adjustment' | 'caption'
const DEFAULTS: Record<VideoEditLabelKind, VideoEditLabel> = { bin: 'mango', sequence: 'forest', video: 'iris', audio: 'caribbean', image: 'lavender', text: 'rose', graphic: 'magenta', code: 'cerulean', adjustment: 'violet', caption: 'mango' }
/** 一项实际显示的标签：自己设置的，否则按类型默认。 */
export function videoEditLabelOf(kind: VideoEditLabelKind, label?: VideoEditLabel): VideoEditLabel {
  return label ?? DEFAULTS[kind]
}
type LabeledBin = { id: string; parentId?: string; label?: VideoEditLabel }
/** 所在素材箱（由近到远找上级箱）设过的标签；都没设或不在箱里时为空。 */
export function videoEditBinLabel(bins: readonly LabeledBin[], binId: string | undefined): VideoEditLabel | undefined {
  const seen = new Set<string>()
  for (let id = binId; id && !seen.has(id); ) {
    seen.add(id)
    const bin = bins.find(value => value.id === id)
    if (!bin) return undefined
    if (bin.label) return bin.label
    id = bin.parentId
  }
  return undefined
}
/**
 * 时间线上一个片段的标签色：素材项（嵌套序列也看序列本身）设了标签就用它，再看它所在素材箱的标签，链接的声音部分与画面同色；
 * 都没设时按片段类型取默认，声音部分取音频的默认色。
 */
export function videoEditClipLabel(document: { items: readonly { id: string; kind: string; label?: VideoEditLabel; sequenceId?: string; binId?: string }[]; sequences?: readonly { id: string; label?: VideoEditLabel; binId?: string }[]; bins?: readonly LabeledBin[] }, clip: { itemId: string; kind: string; sourceComponent?: 'video' | 'audio' }): VideoEditLabel {
  const item = document.items.find(value => value.id === clip.itemId)
  const nested = item?.kind === 'sequence' ? document.sequences?.find(value => value.id === item.sequenceId) : undefined
  const bins = document.bins ?? []
  const explicit = item?.label ?? nested?.label ?? videoEditBinLabel(bins, item?.binId) ?? videoEditBinLabel(bins, nested?.binId)
  if (explicit) return explicit
  const sound = clip.kind === 'audio' || clip.sourceComponent === 'audio'
  const kind = sound ? 'audio' : (clip.kind in DEFAULTS ? clip.kind : 'video') as VideoEditLabelKind
  return DEFAULTS[kind]
}
