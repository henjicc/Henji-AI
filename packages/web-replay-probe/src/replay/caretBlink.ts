/**
 * Blinks the text caret on page time. The native caret blinks on the wall clock, but a slowed replay
 * runs the page `scale` times slower than the video it produces, so the caret flashed `scale` times too
 * fast (about six times a second at 4K60). The native blink is switched off with `caret-animation:
 * manual` and replaced by a blink on the page's own timers: shown for one interval, hidden for one, and
 * shown again whenever the caret moves, like the system caret. Constructed sheets leave the app's DOM untouched.
 */
const BLINK_MS = 530

export function installCaretBlink(): void {
  const manual = new CSSStyleSheet()
  manual.replaceSync('*,*::before,*::after{caret-animation:manual!important}')
  const hidden = new CSSStyleSheet()
  hidden.replaceSync('*,*::before,*::after{caret-color:transparent!important}')
  hidden.disabled = true
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, manual, hidden]

  // The page clock is already slowed by the time this runs, so these timers follow page time.
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = (): void => {
    hidden.disabled = !hidden.disabled
    timer = setTimeout(tick, BLINK_MS)
  }
  const restart = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    hidden.disabled = true
    timer = setTimeout(tick, BLINK_MS)
  }
  for (const type of ['keydown', 'input', 'mousedown', 'focusin']) addEventListener(type, restart, { capture: true, passive: true })
  document.addEventListener('selectionchange', restart, { passive: true })
  restart()
}
