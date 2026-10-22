import { getPlatform } from '@/platform/runtime'
import { installCodeSourceReader } from '@/core/videoEdit/codeMaterial/sources'
import { installAuthorNativeModules } from '../engine/videoEditAuthorModules'
import { prepareVideoEditNativeModules } from './videoEditNativeModules'

let initialized = false
/** 在代码读取/编译装配点显式接线；导入本模块不安装全局 reader。 */
export function initializeVideoEditCodeSourceRuntime(): void {
  if (initialized) return
  installCodeSourceReader(file => getPlatform().documents.readCodeFile(file))
  installAuthorNativeModules(prepareVideoEditNativeModules)
  initialized = true
}
