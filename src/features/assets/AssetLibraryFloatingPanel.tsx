import React, { useEffect, useRef } from 'react'
import { UiPanel } from '@/components/ui'
import { useDialogTransition } from '@/components/ui/useDialogTransition'
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion'
import { AssetLibrarySurface } from './AssetLibrarySurface'
import { isAssetChildOverlayTarget } from './assetOverlayOwnership'

interface Props { open: boolean; position: 'top' | 'left' | 'right'; onClose: () => void; onOpenWorkspace: () => void }

export const AssetLibraryFloatingPanel: React.FC<Props> = ({ open, position, onClose, onOpenWorkspace }) => {
  const { shouldRender, isVisible } = useDialogTransition(open, UI_DIALOG_TRANSITION_MS)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (document.querySelector('[data-asset-preview="open"]')) return
      if (isAssetChildOverlayTarget(event.target)) return
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [onClose, open])

  const positionClass = position === 'left' ? 'left-3 top-12 bottom-3 w-[min(900px,calc(100vw-24px))]' : position === 'right' ? 'right-3 top-12 bottom-3 w-[min(900px,calc(100vw-24px))]' : 'left-1/2 top-12 h-[min(70vh,680px)] w-[min(900px,calc(100vw-32px))] -translate-x-1/2'
  const motionClass = position === 'top'
    ? isVisible ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-2 scale-[0.985] opacity-0'
    : position === 'left'
      ? isVisible ? 'translate-x-0 opacity-100' : '-translate-x-2 opacity-0'
      : isVisible ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'
  return <UiPanel ref={panelRef} variant="glass" aria-hidden={!open} className={`fixed z-panel overflow-hidden transition-[opacity,transform] duration-200 ease-out ${isVisible ? 'pointer-events-auto' : 'pointer-events-none'} ${shouldRender ? 'visible' : 'invisible'} ${positionClass} ${motionClass}`} data-asset-floating-panel data-application-surface-id="overlay.assets">{shouldRender ? <AssetLibrarySurface mode="floating" active={open} onClose={onClose} onOpenWorkspace={onOpenWorkspace} /> : null}</UiPanel>
}
