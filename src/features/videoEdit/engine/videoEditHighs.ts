import highsLoader, { type Highs } from 'highs'
import wasmURL from 'highs/runtime?url'

/*
 * HiGHS 线性规划（WASM，MIT）：防抖的 L1 最优相机路径求解。渲染 Worker 与主线程各加载一次。
 * Node（单测）里由加载器自己从包内读取 wasm；打包后的页面与 Worker 用 Vite 产出的资源地址。
 */
let ready: Promise<Highs> | undefined
export function loadVideoEditHighs(): Promise<Highs> {
  const node = typeof process !== 'undefined' && Boolean(process.versions?.node)
  return ready ??= highsLoader(node ? {} : { locateFile: () => wasmURL }).catch((error: unknown) => { ready = undefined; throw error })
}
