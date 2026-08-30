/** 同一个 key 的文件状态流转串行执行，不同文档仍可并行。 */
export class KeyedSerialExecutor {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    let release: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.catch(() => undefined).then(() => current)
    this.tails.set(key, tail)
    await previous.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release?.()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}
