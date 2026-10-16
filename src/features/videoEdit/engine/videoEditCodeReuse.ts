/** A changing scalar is a proof of inequality, never a proof of equality.
 * Remember the last differing path so dynamic frames do not serialize whole
 * trees. Once it stops changing, resume full precision canonical comparison. */
export class CodeReuseProbe {
  private exact?: string
  private probe?: { path: string[]; value: unknown }

  signature(value: unknown, serialize: () => string): string | undefined {
    if (this.probe) {
      let current = value
      for (const key of this.probe.path) current = current !== null && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
      if ((current === null || typeof current !== 'object') && current !== this.probe.value) {
        this.probe.value = current
        return undefined
      }
      this.probe = undefined
    }
    const exact = serialize()
    if (this.exact !== undefined && this.exact !== exact) {
      const previous: unknown = JSON.parse(this.exact)
      this.probe = difference(previous, value)
    }
    this.exact = exact
    return exact
  }
}

const editorKeys = new Set(['elementId', 'authorElementId', 'elementPath', 'sourceSpan'])
function difference(previous: unknown, current: unknown, path: string[] = []): { path: string[]; value: unknown } | undefined {
  if (previous === current) return undefined
  if (current === null || typeof current !== 'object') return { path, value: current }
  if (!previous || typeof previous !== 'object') return undefined
  if (Array.isArray(previous) && Array.isArray(current) && previous.length !== current.length) return { path: [...path, 'length'], value: current.length }
  for (const key of Object.keys(previous)) {
    if (editorKeys.has(key)) continue
    const found = difference((previous as Record<string, unknown>)[key], (current as Record<string, unknown>)[key], [...path, key])
    if (found) return found
  }
  return undefined
}
