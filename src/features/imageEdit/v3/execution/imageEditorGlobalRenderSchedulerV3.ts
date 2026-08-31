import {
  ImageEditRenderScheduler,
  type ImageEditRenderSchedulerSnapshot,
} from '@/core/imageEdit/v3/renderScheduler'

/**
 * 渲染进程内唯一的图片编辑原子任务调度器。
 *
 * 导出必须逐瓦片重新排队，预览/视口 Worker 必须把一次可取消的渲染帧作为一个原子任务
 * 登记进来。这样同一 GPU lane 始终串行，CPU lane 最多两个任务，交互任务可在导出瓦片
 * 之间抢占，而不会让每个编辑器私建一条互不感知的队列。
 */
const globalRenderSchedulerV3 = new ImageEditRenderScheduler({ cpuConcurrency: 2 })

export function getImageEditorGlobalRenderSchedulerV3(): ImageEditRenderScheduler {
  return globalRenderSchedulerV3
}

export function inspectImageEditorGlobalRenderSchedulerV3(): ImageEditRenderSchedulerSnapshot {
  return globalRenderSchedulerV3.snapshot()
}
