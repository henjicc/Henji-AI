import { useSyncExternalStore } from 'react'

/**
 * “速度/持续时间”对话框的打开请求（4.13）：命令（Ctrl+R、右键菜单）在任何面板触发，时间线把对话框挂在自己下面。
 * 只是一次性的视图请求，不进剪辑内容与撤销栈；对话框确定时走正式时间线编辑（`kind: 'speed'`）。
 */
export interface VideoEditSpeedDialogRequest { projectId: string; sequenceId: string; clipIds: string[] }
let current: VideoEditSpeedDialogRequest | null = null
const listeners = new Set<() => void>()
function publish(next: VideoEditSpeedDialogRequest | null): void { current = next; for (const listener of listeners) listener() }

export function openVideoEditSpeedDialog(request: VideoEditSpeedDialogRequest): void { publish({ ...request, clipIds: [...request.clipIds] }) }
export function closeVideoEditSpeedDialog(): void { publish(null) }
/** 当前剪辑的打开请求（别的剪辑的请求不在这里显示）。 */
export function useVideoEditSpeedDialogRequest(projectId: string): VideoEditSpeedDialogRequest | null {
  const request = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => current)
  return request?.projectId === projectId ? request : null
}
