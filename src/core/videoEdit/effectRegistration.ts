/** 索引导出名和数组位置保留为来源，重复登记不能由加载顺序决定胜者。 */
export function registerEffects<T extends { readonly id: string }>(index: Readonly<Record<string, T | readonly T[]>>): ReadonlyMap<string, T> {
  const values = new Map<string, T>(), sources = new Map<string, string>()
  for (const [name, exported] of Object.entries(index)) {
    const entries: readonly T[] = Array.isArray(exported) ? exported : [exported as T]
    for (const [position, entry] of entries.entries()) {
      const source = `${name}[${position}]`
      if (values.has(entry.id)) throw new Error(`效果 ${entry.id} 重复登记：${sources.get(entry.id)} 与 ${source}。`)
      values.set(entry.id, entry); sources.set(entry.id, source)
    }
  }
  return values
}
