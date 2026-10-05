import { getPlatform } from '@/platform'
import type {
  WorkRootChangeResult,
  WorkRootInfo,
  WorkRootMoveProgress,
  WorkRootTarget,
  WorkRootTargetInspection,
} from '@/platform/contracts/workRoot'

/*
 * 作品目录（任务 4.2）。移动文件与切换设置全部在主进程完成；渲染层负责在应用关闭屏障里调用
 * （先保存并冻结全部写入，见 Settings/hooks/useDataPath.ts），完成后重新启动。
 */

export function getWorkRootInfo(): Promise<WorkRootInfo> {
  return getPlatform().workRoot.getInfo()
}

export function inspectWorkRootTarget(target: WorkRootTarget): Promise<WorkRootTargetInspection> {
  return getPlatform().workRoot.inspectTarget(target)
}

/** 更换作品目录；进度回调只在本次调用期间有效。 */
export async function changeWorkRoot(
  target: WorkRootTarget,
  onProgress?: (progress: WorkRootMoveProgress) => void,
): Promise<WorkRootChangeResult> {
  const platform = getPlatform().workRoot
  const unsubscribe = onProgress ? platform.onProgress(onProgress) : () => undefined
  try {
    return await platform.change(target)
  } finally {
    unsubscribe()
  }
}

export function cancelWorkRootChange(): Promise<boolean> {
  return getPlatform().workRoot.cancel()
}

export function openWorkRoot(): Promise<void> {
  return getPlatform().workRoot.open()
}

export function relaunchAfterWorkRootChange(): Promise<void> {
  return getPlatform().workRoot.relaunch()
}
