/** 展开轨道的关键帧区（重要记录 019）：同一块区域在“关键帧”与“速度曲线”两种视图间切换。 */
export type VideoEditKeyframeLaneMode = 'keyframes' | 'curve'
/** 展开区显示什么：关键帧区的两种视图，或代码片段引用的片子数据（scene）。 */
export type VideoEditTrackLaneMode = VideoEditKeyframeLaneMode | 'scene'
/** 视图切换所在的第一行。 */
export const KEYFRAME_LANE_HEADER = 32
/** 关键帧视图里每个有动画的属性一行；片子数据视图每个子行同高。 */
export const KEYFRAME_LANE_ROW = 28
/** 速度曲线视图的最小高度：左侧属性列表与“选中的关键帧”形状切换都要放得下。 */
export const KEYFRAME_CURVE_MIN_HEIGHT = 168
const CURVE_FOOTER = 64

/** 片子数据视图显示的子行数：展开的组每个子行一行，收起的组合成一行。 */
export function sceneLaneRowCount(groups: ReadonlyArray<{ readonly kind: string; readonly rows: readonly unknown[] }>, collapsed: ReadonlySet<string>): number {
  return groups.reduce((total, group) => total + (collapsed.has(group.kind) ? 1 : group.rows.length), 0)
}
/**
 * 展开区的高度：关键帧视图与片子数据视图按行数（没有内容时留一行提示），速度曲线视图至少放下左侧列表。
 * 片子数据的行数见 sceneLaneRowCount。
 */
export function keyframeLaneHeight(mode: VideoEditTrackLaneMode, lanes: number): number {
  return mode === 'curve' ? Math.max(KEYFRAME_CURVE_MIN_HEIGHT, KEYFRAME_LANE_HEADER + KEYFRAME_LANE_ROW * lanes + CURVE_FOOTER) : KEYFRAME_LANE_HEADER + KEYFRAME_LANE_ROW * Math.max(1, lanes) + 4
}
