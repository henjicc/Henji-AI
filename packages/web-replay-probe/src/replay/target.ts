import type { ReplayTarget } from './types'

const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim()

function visible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const style = getComputedStyle(element)
  return style.visibility !== 'hidden' && style.visibility !== 'collapse'
}

/** Viewport CSS point of the target right now, or null when nothing matches (or the selector is invalid). */
export function resolveReplayTarget(target: ReplayTarget, root: ParentNode = document): { x: number; y: number } | null {
  if (!target.selector && !target.text) return target.x !== undefined && target.y !== undefined ? { x: target.x, y: target.y } : null
  let candidates: Element[]
  try {
    candidates = Array.from(root.querySelectorAll(target.selector ?? 'body *'))
  } catch {
    return null
  }
  if (target.text) {
    const needle = normalize(target.text)
    const has = (element: Element): boolean => normalize(element.textContent ?? '').includes(needle)
    candidates = candidates.filter(has)
    // By text alone: the smallest element holding the whole text (none of its children holds it all).
    if (!target.selector) candidates = candidates.filter(element => !Array.from(element.children).some(has))
  }
  const element = candidates.filter(visible)[target.index ?? 0]
  if (!element) return null
  const rect = element.getBoundingClientRect()
  const [ox, oy] = target.offset ?? [0.5, 0.5]
  return { x: rect.left + rect.width * ox, y: rect.top + rect.height * oy }
}
