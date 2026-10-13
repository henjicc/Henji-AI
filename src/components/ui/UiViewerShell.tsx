import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { UI_CONTENT_OVERLAY_INSET_CLASS, UI_DURATION, uiTransition } from './motion'
import { isTopmostUiOverlay, UiOverlayLayerProvider } from './overlayOwnership'
import type { useUiViewerShell } from './useUiViewerShell'

interface UiViewerShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  viewer: ReturnType<typeof useUiViewerShell>
  surface?: 'media' | 'canvas'
  inset?: 'window' | 'content'
  presentation?: 'fill' | 'centered'
  controls?: ReactNode
  closeOnBackdrop?: boolean
}

export const UiViewerShell = forwardRef<HTMLDivElement, UiViewerShellProps>(function UiViewerShell(
  { viewer, surface = 'media', inset = 'window', presentation = 'fill', controls, closeOnBackdrop = true, children, className = '', ...props }, ref,
) {
  if (!viewer.shouldRender) return null
  return <div {...props} ref={ref} {...viewer.overlay.layerProps} data-ui-viewer-shell
    role="dialog" aria-modal={viewer.open && viewer.scope === 'viewport' ? true : undefined}
    aria-hidden={!viewer.open || undefined} {...(!viewer.open ? { inert: '' } : {})}
    className={`${viewer.scope === 'container' ? 'absolute inset-0' : `fixed ${inset === 'content' ? UI_CONTENT_OVERLAY_INSET_CLASS : 'inset-0'} z-viewer`} overflow-hidden ${surface === 'media' ? 'bg-media' : 'bg-gap'} ${presentation === 'centered' ? 'flex items-center justify-center p-6' : ''} ${className}`}
    style={{ opacity: viewer.opacity, transition: uiTransition(['opacity'], UI_DURATION.viewer), pointerEvents: viewer.open ? 'auto' : 'none' }}
    onTransitionEnd={viewer.onTransitionEnd}
    onClick={event => { if (viewer.open && closeOnBackdrop && event.target === event.currentTarget && isTopmostUiOverlay(viewer.overlay.id)) viewer.onClose() }}>
    <UiOverlayLayerProvider id={viewer.overlay.id}>{children}{controls}</UiOverlayLayerProvider>
  </div>
})
