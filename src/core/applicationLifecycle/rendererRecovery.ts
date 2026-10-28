/**
 * 主进程与渲染层的约定：主窗口加载地址带 `henjiRecovery=safe` 时，渲染层照常启动、正常进入首页，
 * 但跳过一切“自动重开上次的文档、工作区、序列”的恢复。
 * 只在渲染进程短时间内第二次崩溃后的自动重载、以及多次崩溃后用户手动重新加载时出现，
 * 避免同一份文档反复把界面弄崩。
 */
export const RENDERER_RECOVERY_QUERY = 'henjiRecovery'
export const RENDERER_SAFE_RECOVERY = 'safe'

// 主进程也引用本文件里的常量、编译时没有 DOM 类型，所以经 globalThis 访问地址与历史。
interface PageLocation { location?: { href: string }; history?: { state: unknown; replaceState(state: unknown, unused: string, url: string): void } }

let safeRecovery: boolean | undefined

/**
 * 本次页面是否以安全恢复启动；所有启动恢复都经这里判断，不各自解析地址。
 * 第一次调用时读出结果并记到页面结束，同时把参数从地址里去掉：开发服务器之后的整页刷新不再带着它，
 * 刷新回到原文档的功能照常工作。入口在渲染层启动时先调用一次，免得别处先改了地址。
 */
export function isSafeRendererRecovery(): boolean {
  if (safeRecovery !== undefined) return safeRecovery
  const page = globalThis as PageLocation
  if (!page.location) return (safeRecovery = false)
  const url = new URL(page.location.href)
  safeRecovery = url.searchParams.get(RENDERER_RECOVERY_QUERY) === RENDERER_SAFE_RECOVERY
  if (url.searchParams.has(RENDERER_RECOVERY_QUERY)) {
    url.searchParams.delete(RENDERER_RECOVERY_QUERY)
    page.history?.replaceState(page.history.state, '', url.toString())
  }
  return safeRecovery
}
