/**
 * 长任务的“短等加可查询”：外部客户端的工具超时多在 60 秒左右，能力最多等这么久就要回话。
 * 本次对外能力等待的上限，留出余量让回执先于客户端超时到达。
 */
export const CAPABILITY_SHORT_WAIT_MS = 45_000

/**
 * 等 work 完成，最多等 limitMs：按时完成返回 true，超时返回 false，work 照常在后台继续，结果由调用方从正式状态读回。
 * work 在等待期间失败照常抛出；超时之后才失败的不再冒成未处理的拒绝（失败由业务自身的日志与提示负责）。
 */
export async function waitWithin(work: Promise<unknown>, limitMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), limitMs) })
  try { return await Promise.race([work.then(() => true as const), late]) }
  finally {
    clearTimeout(timer)
    work.catch(() => undefined)
  }
}
