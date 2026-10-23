/**
 * Draws the pointer inside the replayed page, so every captured frame shows it. The replay engine
 * dispatches trusted input, so the overlay simply follows the page's own mouse events. It lives in
 * a closed shadow root on <html> with pointer-events: none: hit testing and the app's DOM are untouched.
 */
// The pointer is drawn inside the recorded app's page; it must stay a fixed white/black system-like cursor, not a Henji theme colour.
// eslint-disable-next-line no-restricted-syntax
const ARROW = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3 L5 19.5 L9.3 15.6 L12.1 21.8 L14.9 20.6 L12.1 14.5 L18 14.5 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'
// eslint-disable-next-line no-restricted-syntax
const BEAM = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M9 4 h6 M12 4 v16 M9 20 h6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><path d="M9 4 h6 M12 4 v16 M9 20 h6" fill="none" stroke="#111" stroke-width="1.4" stroke-linecap="round"/></svg>'
const HOTSPOT = { arrow: [5, 3], beam: [12, 12] } as const

function cursorKind(target: EventTarget | null): 'arrow' | 'beam' {
  if (!(target instanceof Element)) return 'arrow'
  const cursor = getComputedStyle(target).cursor
  if (cursor === 'text' || cursor === 'vertical-text') return 'beam'
  if (cursor === 'auto' && target.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable=""], [contenteditable="true"]')) return 'beam'
  return 'arrow'
}

export function installCursorOverlay(): void {
  const mount = (): void => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict'
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>
      .cursor{position:absolute;left:0;top:0;width:24px;height:24px;display:none;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35));will-change:transform}
      .ripple{position:absolute;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:2px solid rgba(64,128,255,.9);background:rgba(64,128,255,.18);animation:ripple .42s ease-out forwards}
      @keyframes ripple{from{transform:scale(.3);opacity:1}to{transform:scale(1.25);opacity:0}}
    </style><div class="cursor"></div>`
    const cursor = root.querySelector('.cursor') as HTMLDivElement
    let kind: 'arrow' | 'beam' | null = null
    const place = (event: MouseEvent): void => {
      const next = cursorKind(event.target)
      if (next !== kind) { kind = next; cursor.innerHTML = next === 'beam' ? BEAM : ARROW }
      const [hx, hy] = HOTSPOT[kind]
      cursor.style.display = 'block'
      cursor.style.transform = `translate(${event.clientX - hx}px, ${event.clientY - hy}px)`
    }
    addEventListener('mousemove', place, { capture: true, passive: true })
    addEventListener('mousedown', event => {
      place(event)
      const ripple = document.createElement('div')
      ripple.className = 'ripple'
      ripple.style.left = `${event.clientX}px`
      ripple.style.top = `${event.clientY}px`
      ripple.addEventListener('animationend', () => ripple.remove())
      root.appendChild(ripple)
    }, { capture: true, passive: true })
    document.documentElement.appendChild(host)
  }
  if (document.documentElement) mount()
  else document.addEventListener('readystatechange', mount, { once: true })
}
