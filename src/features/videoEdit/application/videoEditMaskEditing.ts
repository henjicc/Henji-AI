import type { VideoEditCompositeTarget } from './videoEditCompositing'

/*
 * 节目监视器上正在编辑哪个效果的遮罩（任务 4.10，视图状态，不进剪辑文件与撤销）：
 * 效果控件里点遮罩或“钢笔”时设定，节目监视器据此画出路径与控制柄；换片段、删效果后自动失效（由叠层按文档核对）。
 */

export interface VideoEditMaskEditingTarget extends VideoEditCompositeTarget {
  effectId: string
  /** 选中的遮罩（显示控制柄）；没有时只显示路径。 */
  shapeId?: string
  /** 顶点选区只属于监视器视图，不进文档与撤销。 */
  pointIndex?: number
  /** 钢笔：在节目监视器上逐点画一条新路径。 */
  pen?: boolean
}

let lastUpdate: { sequenceId: string; revision: number; at: number } | undefined
/** 性能诊断时间戳，不属于产品状态；一次只保留最近的遮罩更新。 */
export function recordVideoEditMaskUpdate(sequenceId: string, revision: number, at = performance.now()): void { lastUpdate = { sequenceId, revision, at } }
export function videoEditMaskUpdateTime(sequenceId: string, revision: number): number | undefined {
  if (lastUpdate?.sequenceId !== sequenceId || lastUpdate.revision !== revision) return
  const at = lastUpdate.at; lastUpdate = undefined
  return at
}

export { getVideoEditMaskEditing, videoEditMaskEditingRevision, subscribeVideoEditMaskEditing, setVideoEditMaskEditing } from './videoEditMonitorEditing'
