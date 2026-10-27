import { CAPTURE_TOKEN_COLORS, CAPTURE_TOKEN_CSS_PX } from './types'

/**
 * Marks each captured frame: the engine asks for token n when it renders frame n, and the colour lands
 * in that frame's picture together with everything the page drew for it. Mounted lazily in a closed
 * shadow root on <html> (pointer-events none, topmost), like the cursor overlay; the app's DOM is untouched.
 */
export function installCaptureToken(): { show(index: number): void; repaint(): void } {
  let square: HTMLDivElement | null = null
  let shown: [number, number, number] | null = null
  let shade = false
  const mount = (): HTMLDivElement => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647'
    const root = host.attachShadow({ mode: 'closed' })
    const div = document.createElement('div')
    div.style.cssText = `position:fixed;left:0;top:0;width:${CAPTURE_TOKEN_CSS_PX}px;height:${CAPTURE_TOKEN_CSS_PX}px;pointer-events:none`
    root.appendChild(div)
    document.documentElement.appendChild(host)
    return div
  }
  const paint = (): void => {
    if (!shown || !document.documentElement) return
    if (!square || !square.isConnected) square = mount()
    // Two shades of the same token (well inside the reader's tolerance) let a repaint be forced without changing the token.
    const [r, g, b] = shown.map(value => (shade ? Math.max(0, Math.min(255, value + (value > 127 ? -12 : 12))) : value))
    square.style.background = `rgb(${r},${g},${b})`
  }
  return {
    show(index) {
      const n = CAPTURE_TOKEN_COLORS.length
      shown = [...CAPTURE_TOKEN_COLORS[((index % n) + n) % n]] as [number, number, number]
      paint()
    },
    /** The browser dropped the frame's capture: repaint the same token so it is captured again. */
    repaint() { shade = !shade; paint() },
  }
}
