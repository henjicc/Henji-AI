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
  /** 内容自己负责进出场（如图片从缩略图放大）时关掉整体淡入，外壳只淡入背景。 */
  contentFade?: boolean
}

/**
 * 背景与内容分两层：背景先铺好（开启毛玻璃时是虚化的界面，关闭时是媒体实底），
 * 内容随后淡入或由查看器自己做放大动画。
 */
export const UiViewerShell = forwardRef<HTMLDivElement, UiViewerShellProps>(function UiViewerShell(
  { viewer, surface = 'media', inset = 'window', presentation = 'fill', controls, closeOnBackdrop = true, contentFade = true, children, className = '', ...props }, ref,
) {
  if (!viewer.shouldRender) return null
  const fade = { opacity: viewer.opacity, transition: uiTransition(['opacity'], UI_DURATION.slow) }
  return <div {...props} ref={ref} {...viewer.overlay.layerProps} data-ui-viewer-shell
    role="dialog" aria-modal={viewer.open && viewer.scope === 'viewport' ? true : undefined}
    aria-hidden={!viewer.open || undefined} {...(!viewer.open ? { inert: '' } : {})}
    className={`${viewer.scope === 'container' ? 'absolute inset-0' : `fixed ${inset === 'content' ? UI_CONTENT_OVERLAY_INSET_CLASS : 'inset-0'} z-viewer`} overflow-hidden ${className}`}
    style={{ pointerEvents: viewer.open ? 'auto' : 'none' }}
    onClick={event => {
      const backdrop = event.target === event.currentTarget || (event.target as HTMLElement).dataset.uiViewerLayer !== undefined
      if (viewer.open && closeOnBackdrop && backdrop && isTopmostUiOverlay(viewer.overlay.id)) viewer.onClose()
    }}>
    <div aria-hidden data-ui-viewer-layer="backdrop" className={`absolute inset-0 ${surface === 'media' ? 'ui-viewer-backdrop' : 'bg-gap'}`}
      style={fade} onTransitionEnd={viewer.onTransitionEnd} />
    <div data-ui-viewer-layer="content" className={`absolute inset-0 ${presentation === 'centered' ? 'flex items-center justify-center p-6' : ''}`}
      style={contentFade ? fade : undefined}>
      <UiOverlayLayerProvider id={viewer.overlay.id}>{children}{controls}</UiOverlayLayerProvider>
    </div>
  </div>
})
