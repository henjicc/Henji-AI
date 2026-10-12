/** Paths are deliberately collected from values AND keys (image pools use path keys).
 * Unknown local protocols must be resolved by the host, never silently discarded. */
export function collectMediaReferences(value: unknown): string[] {
  const paths = new Set<string>()
  const seen = new Set<object>()
  const queue: unknown[] = [value]
  while (queue.length) {
    const item = queue.pop()
    if (typeof item === 'string') {
      if (/^(?:[a-z]:[\\/]|[/\\]|file:|henji(?:-media)?:)/i.test(item)) paths.add(item)
    } else if (item && typeof item === 'object' && !seen.has(item)) {
      seen.add(item)
      if (ArrayBuffer.isView(item) || item instanceof ArrayBuffer || item instanceof Blob) continue
      if (item instanceof Map) for (const [key, child] of item) queue.push(key, child)
      else if (item instanceof Set) for (const child of item) queue.push(child)
      else for (const [key, child] of Object.entries(item)) queue.push(key, child)
    }
  }
  return [...paths]
}
