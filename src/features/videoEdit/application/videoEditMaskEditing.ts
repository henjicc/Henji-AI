import type { VideoEditCompositeTarget } from './videoEditCompositing'
import { setVideoEditTrackingEditing } from './videoEditTrackingEditing'

/*
 * 节目监视器上正在编辑哪个效果的遮罩（任务 4.10，视图状态，不进剪辑文件与撤销）：
 * 效果控件里点遮罩或“钢笔”时设定，节目监视器据此画出路径与控制柄；换片段、删效果后自动失效（由叠层按文档核对）。
 */

export interface VideoEditMaskEditingTarget extends VideoEditCompositeTarget {
  effectId: string
  /** 选中的遮罩（显示控制柄）；没有时只显示路径。 */
  shapeId?: string
  /** 钢笔：在节目监视器上逐点画一条新路径。 */
  pen?: boolean
}

let current: VideoEditMaskEditingTarget | null = null
let revision = 0
const listeners = new Set<() => void>()

export function getVideoEditMaskEditing(): VideoEditMaskEditingTarget | null { return current }
export function videoEditMaskEditingRevision(): number { return revision }
export function subscribeVideoEditMaskEditing(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function setVideoEditMaskEditing(target: VideoEditMaskEditingTarget | null): void {
  if (target) setVideoEditTrackingEditing(null)
  if (JSON.stringify(target) === JSON.stringify(current)) return
  current = target; revision++
  for (const listener of listeners) listener()
}
