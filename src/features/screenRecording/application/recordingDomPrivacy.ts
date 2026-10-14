import type { RecordingSensitiveDom } from '@/core/screenRecording/contracts'
/** No values, names, placeholders, text or DOM identifiers leave the renderer. */
export function sensitiveDomRegions(root: Document, ids: WeakMap<Element, string>): RecordingSensitiveDom {
  const result: RecordingSensitiveDom = []
  for (const element of root.querySelectorAll('input[type="password"]')) {
    if (result.length >= 256) break
    const rect = element.getBoundingClientRect(), style = root.defaultView?.getComputedStyle(element)
    if (rect.width <= 0 || rect.height <= 0 || style?.visibility === 'hidden' || style?.display === 'none' || Number(style?.opacity ?? 1) === 0) continue
    const x = Math.max(0, rect.x), y = Math.max(0, rect.y), width = Math.min(root.documentElement.clientWidth, rect.right) - x, height = Math.min(root.documentElement.clientHeight, rect.bottom) - y
    if (width <= 0 || height <= 0) continue
    let id = ids.get(element); if (!id) { id = crypto.randomUUID(); ids.set(element, id) }
    result.push({ id, x, y, width, height })
  }
  return result
}
