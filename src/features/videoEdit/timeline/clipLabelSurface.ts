import { VIDEO_EDIT_LABEL_COLOR_HEX } from '@/core/theme/colorTokens'
import type { VideoEditLabel } from '@/core/videoEdit/labels'

/**
 * 时间线片段的底色与描边（重要记录 019）：按片段的标签色（素材自己设的标签，否则按类型默认），与面板底按比例混合，
 * 深浅主题下都是同一色相的安静色块；描边再浓一些，选中时改用强调描边（由调用方的类名给出）。
 */
export function videoEditClipLabelSurface(label: VideoEditLabel, selected: boolean): { backgroundColor: string; borderColor?: string } {
  const hex = VIDEO_EDIT_LABEL_COLOR_HEX[label]
  return { backgroundColor: `color-mix(in srgb, ${hex} 30%, rgb(var(--panel-rgb)))`, ...(selected ? {} : { borderColor: `color-mix(in srgb, ${hex} 52%, rgb(var(--panel-rgb)))` }) }
}
