/** 只发送状态变化；失败后重试最新事实，关闭最后剪辑时的 false 也必须送达。 */
export function createWebCacheActivityReporter(send: (active: boolean) => Promise<void>, failed: (error: unknown) => void): (active: boolean) => void {
  let started = false, desired = false, acknowledged: boolean | undefined, inFlight = false
  let retry: ReturnType<typeof setTimeout> | undefined
  const flush = (): void => {
    if (!started || inFlight || acknowledged === desired) return
    clearTimeout(retry); retry = undefined
    const sent = desired
    acknowledged = undefined
    inFlight = true
    let error: unknown, rejected = false
    void Promise.resolve().then(() => send(sent)).then(() => { acknowledged = sent }, reason => {
      rejected = true; error = reason
    }).finally(() => {
      inFlight = false
      if (rejected) failed(error)
      if (acknowledged === desired) return
      if (desired !== sent) flush()
      else retry = setTimeout(flush, 1000)
    })
  }
  return active => {
    if (active) started = true
    if (desired === active && retry) return
    desired = active
    flush()
  }
}
