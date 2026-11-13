/**
 * 正在后台进行的停止收尾、恢复、导入：能力只等约 45 秒就回话，没做完的在这里登记。
 * 会话读回的 details.finishing 据此说还在进行；做完后失败的原因留在 details.error，免得调用方只看到 finishing 变回 false 就当成成功。
 */
const running = new Map<string, Promise<unknown>>()
const failures = new Map<string, string>()

export function trackRecordingWork<T>(sessionId: string, work: Promise<T>): Promise<T> {
  running.set(sessionId, work)
  failures.delete(sessionId)
  void work.then(() => undefined, (error: unknown) => { failures.set(sessionId, error instanceof Error ? error.message : String(error)) })
    .finally(() => { if (running.get(sessionId) === work) running.delete(sessionId) })
  return work
}
export function recordingWorkInProgress(sessionId: string): boolean { return running.has(sessionId) }
/** 这次录制最近一次停止收尾、恢复或导入失败的原因；之后再发起一次就清掉。 */
export function recordingWorkFailure(sessionId: string): string | null { return failures.get(sessionId) ?? null }
