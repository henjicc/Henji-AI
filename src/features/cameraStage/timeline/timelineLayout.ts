/** 时间轴布局常量与共享类型（非组件模块，避免 react-refresh 混合导出告警） */

/** 刻度尺行高（px） */
export const TIMELINE_RULER_HEIGHT = 22
/** 单条轨道行高（px） */
export const TIMELINE_ROW_HEIGHT = 22
/** 左侧轨道树标签列宽（px） */
export const TIMELINE_LABEL_WIDTH = 208
/** 右侧内容区最小宽度（px） */
export const TIMELINE_MIN_CONTENT_WIDTH = 600

/** 缓动编辑目标：定位某对象某属性路径上某时间的关键帧 */
export interface EasingEditTarget {
  objectId: string
  path: string
  time: number
}
