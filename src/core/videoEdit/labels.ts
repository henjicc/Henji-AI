import { z } from 'zod'

/**
 * 素材面板的颜色标签（剪辑对齐 PR 3.2）：与 PR 默认标签同名的 16 种颜色。素材项、素材箱与序列可各自设置；
 * 没设置时按类型取默认（PR“标签默认值”：素材箱芒果黄、序列森林绿、视频鸢尾花、音频加勒比海蓝、静止图像淡紫）。
 * 颜色值是内容色，登记在 `core/theme/colorTokens.ts`。
 */
export const VIDEO_EDIT_LABELS = ['violet', 'iris', 'caribbean', 'lavender', 'cerulean', 'forest', 'rose', 'mango', 'purple', 'blue', 'teal', 'magenta', 'tan', 'green', 'brown', 'yellow'] as const
export type VideoEditLabel = typeof VIDEO_EDIT_LABELS[number]
export const videoEditLabelSchema = z.enum(VIDEO_EDIT_LABELS)
export const VIDEO_EDIT_LABEL_NAMES: Record<VideoEditLabel, string> = {
  violet: '紫罗兰色', iris: '鸢尾花色', caribbean: '加勒比海蓝色', lavender: '淡紫色', cerulean: '天蓝色', forest: '森林绿色', rose: '玫瑰红色', mango: '芒果黄色',
  purple: '紫色', blue: '蓝色', teal: '深青色', magenta: '洋红色', tan: '棕黄色', green: '绿色', brown: '棕色', yellow: '黄色',
}
export type VideoEditLabelKind = 'bin' | 'sequence' | 'video' | 'audio' | 'image' | 'text' | 'code' | 'graphic' | 'adjustment'
const DEFAULTS: Record<VideoEditLabelKind, VideoEditLabel> = { bin: 'mango', sequence: 'forest', video: 'iris', audio: 'caribbean', image: 'lavender', text: 'rose', graphic: 'rose', code: 'cerulean', adjustment: 'violet' }
/** 一项实际显示的标签：自己设置的，否则按类型默认。 */
export function videoEditLabelOf(kind: VideoEditLabelKind, label?: VideoEditLabel): VideoEditLabel {
  return label ?? DEFAULTS[kind]
}
