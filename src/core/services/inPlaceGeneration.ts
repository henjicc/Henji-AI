/** 同一个生成结果只能落位一次；保存未确认时只续保存。宿主负责持久落位回执。 */
export async function completeInPlaceGeneration<T>(ports: {
  signal: AbortSignal;
  readApplied(): T | undefined;
  wait(): Promise<{ ok: true } | { ok: false; error: string }>;
  place(): Promise<T>;
  markApplied(result: T): void;
  save(): Promise<void>;
}): Promise<T> {
  ports.signal.throwIfAborted();
  let result = ports.readApplied();
  if (result === undefined) {
    const outcome = await ports.wait();
    ports.signal.throwIfAborted();
    if (!outcome.ok) throw new Error(outcome.error);
    result = await ports.place();
    // 回执先于保存、取消检查；异步保存失败不能重新落位。
    ports.markApplied(result);
  }
  await ports.save();
  return result;
}
