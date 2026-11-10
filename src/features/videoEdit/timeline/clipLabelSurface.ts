import { VIDEO_EDIT_LABEL_COLOR_HEX } from '@/core/theme/colorTokens'
import type { VideoEditLabel } from '@/core/videoEdit/labels'

/**
 * 时间线片段的底色（重要记录 019）：按片段的标签色（素材自己设的标签，否则按类型默认）与面板底按比例混合，
 * 深浅主题下都是同一色相的安静色块。片段不描边；选中时底色提亮一档，白色细线由调用方叠在最上层。
 */
export function videoEditClipLabelSurface(label: VideoEditLabel, selected: boolean): { backgroundColor: string } {
  return { backgroundColor: `color-mix(in srgb, ${VIDEO_EDIT_LABEL_COLOR_HEX[label]} ${selected ? 42 : 30}%, rgb(var(--panel-rgb)))` }
}
/** 片段名条的底色：同一色相，比片段底色暗一档，名字压在上面不和缩略图、波形抢地方。 */
export function videoEditClipTitleSurface(label: VideoEditLabel, selected: boolean): { backgroundColor: string } {
  return { backgroundColor: `color-mix(in srgb, ${VIDEO_EDIT_LABEL_COLOR_HEX[label]} ${selected ? 34 : 22}%, rgb(var(--window-rgb)))` }
}
/** 选中的片段、字幕在最上层叠一圈主要文字色细线：强调色留给播放头，两者常叠在一起。 */
export const TIMELINE_SELECTED_RING_CLASS = 'pointer-events-none absolute inset-0 z-raised rounded-check ring-1 ring-inset ring-text1'
