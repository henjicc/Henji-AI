import { videoEditAnnotationPaletteIndex } from '@/core/videoEdit/annotations'

/** 轮换色的底色类：Tailwind 只认完整类名，按色号逐个写出。 */
const FILL_CLASS = ['bg-annotation1', 'bg-annotation2', 'bg-annotation3', 'bg-annotation4', 'bg-annotation5', 'bg-annotation6', 'bg-annotation7', 'bg-annotation8'] as const

/** 第 number 条批注的颜色（CSS 颜色值），给画面上的形状、箭头描边用。 */
export function videoEditAnnotationColor(number: number): string { return `rgb(var(--annotation${videoEditAnnotationPaletteIndex(number) + 1}-rgb))` }
/** 第 number 条批注的底色类（序号徽标、时间线与节目标尺上的记号）。 */
export function videoEditAnnotationFillClass(number: number): string { return FILL_CLASS[videoEditAnnotationPaletteIndex(number)] }
