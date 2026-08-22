/**
 * 3D 镜头参考的渲染方式（成像风格）：决定摄像机画面与最终成片是彩色成像，
 * 还是深度、线稿这类给生成模型当控制图用的画面。
 *
 * 纯数据定义，禁止引入 three.js 或 UI 依赖；具体成像实现在 render/stageStyleRenderer.ts。
 */

export const STAGE_RENDER_STYLE_VALUES = ['beauty', 'depth', 'lineart', 'normal', 'silhouette'] as const

export type StageRenderStyle = (typeof STAGE_RENDER_STYLE_VALUES)[number]

export const DEFAULT_STAGE_RENDER_STYLE: StageRenderStyle = 'beauty'

export const STAGE_RENDER_STYLE_LABELS: Record<StageRenderStyle, string> = {
  beauty: '彩色',
  depth: '深度图',
  lineart: '线稿图',
  normal: '法线图',
  silhouette: '剪影图',
}

/** 供下拉控件直接消费的稳定引用：不要在渲染里 [...] 复制，那会让消费方的布局副作用每帧重跑 */
export const STAGE_RENDER_STYLE_OPTIONS: Array<{ value: StageRenderStyle; label: string }> =
  STAGE_RENDER_STYLE_VALUES.map((value) => ({ value, label: STAGE_RENDER_STYLE_LABELS[value] }))

export function isStageRenderStyle(raw: unknown): raw is StageRenderStyle {
  return typeof raw === 'string' && (STAGE_RENDER_STYLE_VALUES as readonly string[]).includes(raw)
}

/** 旧工程没有这个字段、或写入了非法值时一律回退彩色，保证老工程按原样出片。 */
export function normalizeStageRenderStyle(raw: unknown): StageRenderStyle {
  return isStageRenderStyle(raw) ? raw : DEFAULT_STAGE_RENDER_STYLE
}
