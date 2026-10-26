/**
 * 安全框（SMPTE ST 2046-1、EBU R 95 的高清安全区）：动作安全区占画面宽、高各 93%（四边各留 3.5%），
 * 字幕与图形安全区占 90%（四边各留 5%）。按合成画面自身的宽高计算，横屏、竖屏、方形同一规则；
 * 和监视器缩放、留黑无关。只是看片辅助线，不进画面、不进导出。
 */
export const VIDEO_EDIT_SAFE_MARGINS = { action: 0.035, title: 0.05 } as const

/** 安全区在画面里的位置（0–1，左上为原点）。 */
export interface VideoEditSafeArea { x: number; y: number; width: number; height: number }

export function videoEditSafeArea(kind: keyof typeof VIDEO_EDIT_SAFE_MARGINS): VideoEditSafeArea {
  const margin = VIDEO_EDIT_SAFE_MARGINS[kind]
  return { x: margin, y: margin, width: 1 - 2 * margin, height: 1 - 2 * margin }
}
