import type { Modifiers, WireFile } from '../protocol'
import { bytesToWire } from '../shared/body'
import { describeElementAt, type LocatorOptions } from '../shared/locator'
import { nowUs, type EventQueue } from './events'

const MOVE_INTERVAL_US = 8000

function mods(e: MouseEvent | KeyboardEvent | WheelEvent): Modifiers {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0)
}

async function readFiles(list: FileList | null | undefined): Promise<WireFile[]> {
  return Promise.all([...(list ?? [])].map(async f => ({ name: f.name, type: f.type, lastModified: f.lastModified, body: bytesToWire(new Uint8Array(await f.arrayBuffer())) })))
}

/** Listens in the capture phase on window so the app cannot stop propagation before the probe sees input. */
export function installInputTap(queue: EventQueue, isActive: () => boolean, locator: LocatorOptions): void {
  const on = <K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void): void => {
    window.addEventListener(type, event => { if (isActive()) handler(event) }, { capture: true, passive: true })
  }
  let lastMove = -Infinity
  on('mousemove', e => {
    const t = nowUs()
    if (t - lastMove < MOVE_INTERVAL_US) return
    lastMove = t
    queue.emit({ kind: 'pointer', t, type: 'move', x: e.clientX, y: e.clientY, button: -1, buttons: e.buttons, clickCount: 0, pointerType: 'mouse', mods: mods(e) })
  })
  const press = (type: 'down' | 'up') => (e: MouseEvent): void => {
    queue.emit({ kind: 'pointer', t: nowUs(), type, x: e.clientX, y: e.clientY, button: e.button, buttons: e.buttons, clickCount: e.detail, pointerType: 'mouse', mods: mods(e), target: describeElementAt(e.target, e.clientX, e.clientY, locator) })
  }
  on('mousedown', press('down'))
  on('mouseup', press('up'))
  on('wheel', e => {
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
    queue.emit({ kind: 'wheel', t: nowUs(), x: e.clientX, y: e.clientY, dx: e.deltaX * scale, dy: e.deltaY * scale, mods: mods(e), target: describeElementAt(e.target, e.clientX, e.clientY, locator) })
  })
  let lastKeyDown: { key: string; t: number } | null = null
  const key = (type: 'down' | 'up') => (e: KeyboardEvent): void => {
    if (type === 'down') lastKeyDown = { key: e.key, t: nowUs() }
    const focused = document.activeElement
    const rect = focused?.getBoundingClientRect()
    queue.emit({
      kind: 'key', t: nowUs(), type, key: e.key, code: e.code, keyCode: e.keyCode, location: e.location, repeat: e.repeat, mods: mods(e),
      composing: e.isComposing || e.keyCode === 229,
      target: rect ? describeElementAt(focused, rect.x + rect.width / 2, rect.y + rect.height / 2, locator) : undefined,
    })
  }
  on('keydown', key('down'))
  on('keyup', key('up'))
  // Text that arrives without a matching key press (some input methods, autocorrect, automation) is
  // recorded as committed text; text typed by a key press replays through that key.
  on('beforeinput', e => {
    if (e.inputType !== 'insertText' || !e.data) return
    if (lastKeyDown && lastKeyDown.key === e.data && nowUs() - lastKeyDown.t < 100_000) return
    const target = e.target instanceof Element ? e.target : null
    const rect = target?.getBoundingClientRect()
    queue.emit({ kind: 'text', t: nowUs(), data: e.data, target: rect ? describeElementAt(target, rect.x + rect.width / 2, rect.y + rect.height / 2, locator) : undefined })
  })
  on('compositionend', e => {
    const target = e.target instanceof Element ? e.target : null
    const rect = target?.getBoundingClientRect()
    if (e.data) queue.emit({ kind: 'text', t: nowUs(), data: e.data, target: rect ? describeElementAt(target, rect.x + rect.width / 2, rect.y + rect.height / 2, locator) : undefined })
  })
  on('paste', e => {
    const data = e.clipboardData
    const target = e.target instanceof Element ? e.target : null
    const rect = target?.getBoundingClientRect()
    const text = data?.getData('text/plain') || undefined
    const html = data?.getData('text/html') || undefined
    const files = data?.files
    queue.emitLater(nowUs(), async () => ({ kind: 'paste', t: 0, text, html, files: await readFiles(files), target: rect ? describeElementAt(target, rect.x + rect.width / 2, rect.y + rect.height / 2, locator) : undefined }))
  })
  on('drop', e => {
    const text = e.dataTransfer?.getData('text/plain') || undefined
    const files = e.dataTransfer?.files
    const target = describeElementAt(e.target, e.clientX, e.clientY, locator)
    queue.emitLater(nowUs(), async () => ({ kind: 'drop', t: 0, x: e.clientX, y: e.clientY, text, files: await readFiles(files), target }))
  })
  on('resize', () => queue.emit({ kind: 'resize', t: nowUs(), width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }))
  on('focus', e => { if (e.target === window) queue.emit({ kind: 'focus', t: nowUs(), focused: true }) })
  on('blur', e => { if (e.target === window) queue.emit({ kind: 'focus', t: nowUs(), focused: false }) })
}
