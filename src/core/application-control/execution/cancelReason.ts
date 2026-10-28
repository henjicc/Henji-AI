/**
 * 撤销连接授权时中止在途调用的原因，放进 AbortController.abort(reason)。宿主断开、页面重载、宿主卸载也会
 * 中止在途调用，但那只是等待方没了：主进程里还能独立跑完的长任务（如网页重演）只有撤销授权会停下，
 * 调用方要停请用 cancel_web_app_replay。
 */
export class ApplicationRevokedReason extends Error {
  constructor() {
    super('连接授权已撤销')
    // 与 DOMException 的中止同名，按 name 判断中止的既有代码照常工作
    this.name = 'AbortError'
  }
}

/** 信号是否因撤销授权而中止。 */
export function abortedByRevocation(signal: AbortSignal): boolean {
  return signal.aborted && signal.reason instanceof ApplicationRevokedReason
}
