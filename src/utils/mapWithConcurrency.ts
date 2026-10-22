/**
 * 按输入顺序返回结果，同时最多 `limit` 个任务在执行。任一任务失败即整体失败（与 Promise.all 相同）；
 * 失败后不再领取新任务，已在执行的任务照常结束。
 */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const index = next++
      try { results[index] = await task(items[index], index) } catch (error) { failed = true; throw error }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
