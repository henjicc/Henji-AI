import { useEffect, useRef } from 'react'
import { UI_DURATION } from './motion'
import { isTopmostUiOverlay, useUiOverlayLayer } from './overlayOwnership'
import { useDialogTransition } from './useDialogTransition'

let scrollOwners = 0
let previousOverflow = ''
interface ViewerOptions {
  enterKey?: unknown
  closeOnEscape?: boolean | (() => boolean)
  /** 仅中心页静态样本使用，不注册模态、不接管键盘与页面滚动。 */
  scope?: 'viewport' | 'container'
}

/** 生命周期放在宿主同层，退出只卸载画面，保留宿主的音量等会话偏好。 */
export function useUiViewerShell(open: boolean, onClose: () => void, options: ViewerOptions = {}) {
  const scope = options.scope ?? 'viewport'
  const transition = useDialogTransition(open, UI_DURATION.viewer, true, { enterKey: options.enterKey })
  const overlay = useUiOverlayLayer(open && scope === 'viewport', { modal: true })
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const escapeRef = useRef(options.closeOnEscape ?? true)
  escapeRef.current = options.closeOnEscape ?? true
  useEffect(() => {
    if (!transition.shouldRender || scope !== 'viewport') return
    if (scrollOwners++ === 0) {
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    return () => { if (--scrollOwners === 0) document.body.style.overflow = previousOverflow }
  }, [scope, transition.shouldRender])
  useEffect(() => {
    if (!open || scope !== 'viewport') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isTopmostUiOverlay(overlay.id)) return
      const allowed = typeof escapeRef.current === 'function' ? escapeRef.current() : escapeRef.current
      if (allowed) { event.preventDefault(); closeRef.current() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, overlay.id, scope])
  return { ...transition, open, onClose, overlay, scope, opacity: transition.isVisible ? 1 : 0 }
}
