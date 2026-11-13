import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { isHeadlessWindow } from '@/platform/runtime'

/*
 * 助手命令行的无窗口运行关掉了显卡（见主进程入口），合成不了任何一帧。不在入口拦住时，取帧与导出要跑到
 * 第 0 帧才以含糊的渲染错误失败，助手会把它当成显卡故障讲给用户、写进制作进度。
 */
export const VIDEO_EDIT_HEADLESS_FRAME_MESSAGE = '当前是无窗口模式（助手命令行），不能合成视频画面：取帧、导出视频与预渲染请在打开的痕迹AI 窗口里执行（例如经外部助手连接），或给命令行加 --visible 再运行。这不是显卡或驱动故障，什么也没有执行。'

export function assertVideoEditFramesComposable(): void {
  if (isHeadlessWindow()) throw new ApplicationPreflightFailure(VIDEO_EDIT_HEADLESS_FRAME_MESSAGE)
}

/** 空闲预渲染在无窗口模式下不启动（它同样要合成画面，失败只会在日志里刷错误）。 */
export function videoEditFramesComposable(): boolean {
  return !isHeadlessWindow()
}
