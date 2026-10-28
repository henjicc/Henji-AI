import { installReplayRuntime } from './runtime'
import type { ReplayHost } from './types'

// 宿主桥只由安装函数的闭包持有，页面脚本不能直接伪造宿主报告。
export function install(host: ReplayHost): void {
  installReplayRuntime(host)
}
