/**
 * Keeps the replay's own overlays (frame token, pointer) above everything the page shows. z-index cannot
 * beat the browser's top layer, where popovers, modal dialogs and fullscreen elements live and the last
 * one shown is drawn on top. So while the page has something of its own in the top layer, each overlay
 * host becomes a manual popover and is shown again after the page's element, landing above it in
 * registration order (the token, registered last, stays topmost so the pointer never covers it). When the
 * page's last top-layer element closes, the hosts leave the top layer and drop the popover attribute,
 * back to plain fixed boxes with the highest z-index.
 *
 * Opening: the page's `showModal`/`showPopover`/`togglePopover` raise the hosts at once. Popovers and
 * dialogs opened without script (popovertarget, commandfor) announce themselves with a synchronous
 * `beforetoggle` before they are shown, so that only marks the layer stale; the asynchronous `toggle`,
 * `fullscreenchange` and the next frame's token paint (`refreshTopLayer`) do the raising. Closing is
 * noticed on `toggle`, `close`, `fullscreenchange`, the page's `hidePopover`, and every token paint.
 *
 * What the page can still notice while the hosts are raised (and only then): they match `:popover-open`
 * (so `html:has(:popover-open)` rules and `querySelectorAll(':popover-open')` see them; the page's
 * `hidePopover`/`togglePopover` on them are ignored), and one sheet appended to
 * `document.adoptedStyleSheets` hides their `::backdrop` by ID with !important. Their own
 * beforetoggle/toggle events are stopped at window in the capture phase, before any page listener;
 * a page could only see them by registering a capture listener on window before the replay runtime,
 * which cannot happen since the runtime is installed first.
 */

const hosts: HTMLElement[] = []
/** The page's own elements seen entering the top layer and not yet seen leaving it. */
const open = new Set<Element>()
let stale = false
let raised = false
let installed = false
let nativeShow: (this: HTMLElement) => void = () => {}
let nativeHide: (this: HTMLElement) => void = () => {}
let backdropSheet: CSSStyleSheet | null = null
let nextId = 0

const HOST_ID = '__henji_replay_overlay_'

/**
 * Inline style for an overlay host: every property starts from its initial value and every declaration
 * is important, so the page's own `[popover]` rules (borders, padding, entry transitions) cannot reach it.
 */
export function topLayerHostCss(declarations: string): string {
  const base = 'all:initial;position:fixed;margin:0;border:0;padding:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647'
  return `${base};${declarations}`.split(';').filter(rule => rule.trim()).map(rule => `${rule} !important`).join(';')
}

const ours = (target: unknown): boolean => hosts.includes(target as HTMLElement)

const matches = (el: Element, selector: string): boolean => { try { return el.matches(selector) } catch { return false } }
const inTopLayer = (el: Element): boolean => el.isConnected && (matches(el, ':popover-open') || matches(el, ':modal') || matches(el, ':fullscreen'))

/** A page's `::backdrop` rule would otherwise paint a scrim under every raised host. */
function hideOwnBackdrops(): void {
  if (!('adoptedStyleSheets' in document) || typeof CSSStyleSheet === 'undefined') return
  backdropSheet ??= new CSSStyleSheet()
  backdropSheet.replaceSync(hosts.map(host => `#${host.id}::backdrop{display:none !important}`).join('\n'))
  keepBackdropSheet()
}

/** The page may assign `document.adoptedStyleSheets` wholesale, dropping ours; put it back. */
function keepBackdropSheet(): void {
  if (!backdropSheet) return
  const sheets = document.adoptedStyleSheets
  if (!sheets.includes(backdropSheet)) document.adoptedStyleSheets = [...sheets, backdropSheet]
}

function raise(): void {
  stale = false
  raised = true
  for (let i = hosts.length - 1; i >= 0; i -= 1) if (!hosts[i].isConnected) hosts.splice(i, 1)
  hideOwnBackdrops()
  for (const host of hosts) {
    host.setAttribute('popover', 'manual')
    try { nativeHide.call(host) } catch { /* not showing */ }
    try { nativeShow.call(host) } catch { /* the browser has no popover support: z-index is all there is */ }
  }
}

function lower(): void {
  stale = false
  raised = false
  for (const host of hosts) {
    try { nativeHide.call(host) } catch { /* not showing */ }
    host.removeAttribute('popover')
  }
}

/** Raises or lowers the hosts to match what the page has in the top layer now. Called before every token paint. */
export function refreshTopLayer(): void {
  for (const el of open) if (!inTopLayer(el)) open.delete(el)
  if (open.size === 0) { if (raised) lower(); else stale = false; return }
  if (stale || !raised) raise()
  else keepBackdropSheet()
}

/** Installs the page hooks; call before any page script so the hosts' own toggle events are stopped first. */
export function installTopLayer(): void {
  if (installed) return
  installed = true
  const proto = HTMLElement.prototype as HTMLElement & Record<string, unknown>
  if (typeof proto.showPopover !== 'function' || typeof proto.hidePopover !== 'function') return
  nativeShow = proto.showPopover
  nativeHide = proto.hidePopover
  const opened = <A extends unknown[], R>(native: (this: HTMLElement, ...args: A) => R) => function (this: HTMLElement, ...args: A): R {
    // The page reaching our hosts (say, closing every open popover) changes nothing.
    if (ours(this)) return undefined as R
    const result = native.apply(this, args)
    if (inTopLayer(this)) { open.add(this); raise() } else refreshTopLayer()
    return result
  }
  proto.showPopover = opened(proto.showPopover)
  if (typeof proto.togglePopover === 'function') proto.togglePopover = opened(proto.togglePopover as (this: HTMLElement, ...args: unknown[]) => boolean)
  const hide = proto.hidePopover
  proto.hidePopover = function (this: HTMLElement) { if (ours(this)) return; hide.call(this); refreshTopLayer() }
  const dialog = typeof HTMLDialogElement === 'undefined' ? null : HTMLDialogElement.prototype
  if (typeof dialog?.showModal === 'function') dialog.showModal = opened(dialog.showModal)

  const state = (event: Event): string | undefined => (event as Event & { newState?: string }).newState
  addEventListener('beforetoggle', event => {
    if (ours(event.target)) { event.stopImmediatePropagation(); return }
    if (state(event) === 'open' && event.target instanceof Element) { open.add(event.target); stale = true }
  }, { capture: true })
  addEventListener('toggle', event => {
    if (ours(event.target)) { event.stopImmediatePropagation(); return }
    // <details> sends toggle events too; only what actually stands in the top layer counts.
    if (state(event) === 'open' && event.target instanceof Element && inTopLayer(event.target)) { open.add(event.target); raise() } else refreshTopLayer()
  }, { capture: true })
  addEventListener('close', refreshTopLayer, { capture: true })
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) { open.add(document.fullscreenElement); raise() } else refreshTopLayer()
  })
}

/** `host` (already in the document, styled with topLayerHostCss) stays above the page's top layer from now on. */
export function keepOnTop(host: HTMLElement): void {
  installTopLayer()
  if (!ours(host)) {
    host.id = `${HOST_ID}${nextId++}`
    hosts.push(host)
  }
  if (open.size > 0) raise()
}
