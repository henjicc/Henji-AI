import { getPlatform } from '@/platform/runtime'
import { installCodeSourceReader } from '@/core/videoEdit/codeMaterial/sources'
import { installAuthorNativeModules } from '../engine/videoEditAuthorModules'
import { configureVideoEditRecordingTrackReader } from '../engine/videoEditTrackResults'
import type { RecordingCursorPageReader } from '../engine/videoEditRecordingCursorSource'
import { prepareVideoEditNativeModules } from './videoEditNativeModules'

/**
 * 主线程读录屏事件页：文档里存的是磁盘路径，主线程经平台文件读取直接读；
 * 渲染 Worker 只能 fetch，由渲染会话边界把路径换成媒体地址。
 */
export const readRecordingPageFile: RecordingCursorPageReader = async (page, signal) => {
  const bytes = await getPlatform().system.fs.readFile(page.path, { maxBytes: 2 * 1024 * 1024 })
  signal.throwIfAborted()
  return new Uint8Array(bytes)
}

let initialized = false
/**
 * 主线程的读取方式在这里显式接线（代码源码、作者原生模块、录屏跟踪的事件页），剪辑实例绑定与渲染会话创建时调用；
 * 导入本模块不安装任何全局 reader。
 */
export function initializeVideoEditCodeSourceRuntime(): void {
  if (initialized) return
  installCodeSourceReader(file => getPlatform().documents.readCodeFile(file))
  installAuthorNativeModules(prepareVideoEditNativeModules)
  configureVideoEditRecordingTrackReader(readRecordingPageFile)
  initialized = true
}
