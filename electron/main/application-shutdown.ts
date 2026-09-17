interface ShutdownApplication {
  on(event: 'will-quit', listener: (event: { preventDefault(): void }) => void): unknown
  quit(): void
}

/** 窗口保存守卫仍可否决 before-quit；只有所有窗口批准关闭后才释放应用服务。 */
export function bindApplicationShutdown(
  application: ShutdownApplication,
  dispose: readonly (() => void | Promise<void>)[],
  reportFailure: (error: unknown) => void,
): void {
  let finished = false
  let pending = false
  application.on('will-quit', (event) => {
    if (finished) return
    event.preventDefault()
    if (pending) return
    pending = true
    void Promise.allSettled(dispose.map(async (close) => close())).then((results) => {
      for (const result of results) if (result.status === 'rejected') reportFailure(result.reason)
    }).finally(() => {
      finished = true
      // 原生 will-quit 尚未退出时，微任务内的 quit 可能被 Electron 的重入保护忽略。
      setImmediate(() => application.quit())
    })
  })
}
