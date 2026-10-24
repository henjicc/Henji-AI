/** 展开轨道的关键帧区（重要记录 019）：同一块区域在“关键帧”与“速度曲线”两种视图间切换。 */
export type VideoEditKeyframeLaneMode = 'keyframes' | 'curve'
/** 视图切换所在的第一行。 */
export const KEYFRAME_LANE_HEADER = 32
/** 关键帧视图里每个有动画的属性一行。 */
export const KEYFRAME_LANE_ROW = 28
/** 速度曲线视图的最小高度：左侧属性列表与“选中的关键帧”形状切换都要放得下。 */
export const KEYFRAME_CURVE_MIN_HEIGHT = 168
const CURVE_FOOTER = 64

/** 关键帧区的高度：关键帧视图按行数（没有关键帧时留一行提示），速度曲线视图至少放下左侧列表。 */
export function keyframeLaneHeight(mode: VideoEditKeyframeLaneMode, lanes: number): number {
  return mode === 'curve' ? Math.max(KEYFRAME_CURVE_MIN_HEIGHT, KEYFRAME_LANE_HEADER + KEYFRAME_LANE_ROW * lanes + CURVE_FOOTER) : KEYFRAME_LANE_HEADER + KEYFRAME_LANE_ROW * Math.max(1, lanes) + 4
}
