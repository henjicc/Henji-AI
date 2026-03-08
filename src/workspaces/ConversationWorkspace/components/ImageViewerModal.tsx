import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiIconButton } from '@/components/ui'
import { ImageEditor } from '@/components/ImageEditor'
import type { ImageEditState } from '@/components/ImageEditor'
import { useImageViewerTransform } from '../hooks/useImageViewerTransform'

export interface ImageViewerModalProps {
  open: boolean
  imageUrl: string
  imageList: string[]
  filePaths: string[]
  currentIndex: number
  fromUpload: boolean
  isEditorMode: boolean
  initialEditState?: ImageEditState
  onClose: () => void
  onNavigate: (direction: 'prev' | 'next') => void
  onEnterEditor: () => void
  onExitEditor: () => void
  onSaveEdit: (dataUrl: string, editState: ImageEditState) => void
  onDownload?: (filePath: string) => void
  onContextMenu?: (e: React.MouseEvent, filePath?: string) => void
}

export function ImageViewerModal({
  open,
  imageUrl,
  imageList,
  filePaths,
  currentIndex,
  fromUpload,
  isEditorMode,
  initialEditState,
  onClose,
  onNavigate,
  onEnterEditor,
  onExitEditor,
  onSaveEdit,
  onDownload,
  onContextMenu,
}: ImageViewerModalProps): JSX.Element | null {
  const { t } = useI18n()
  const [isVisible, setIsVisible] = useState(open)
  const [overlayOpacity, setOverlayOpacity] = useState(0)
  const closeTimerRef = useRef<number | null>(null)
  const {
    containerRef,
    imageRef,
    scaleDisplayRef,
    viewerOpacity,
    resetView,
    handleImageMouseDown,
    handleContainerMouseMove,
    handleContainerMouseUp,
    handleImageMouseMove,
    handleImageLoad,
    isPointOnImageContent,
  } = useImageViewerTransform(open && isVisible)

  useEffect(() => {
    if (!isVisible) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [isVisible])

  useEffect(() => {
    if (open) {
      setIsVisible(true)
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setOverlayOpacity(0)
      requestAnimationFrame(() => {
        setOverlayOpacity(1)
      })
      return
    }
    if (!isVisible) return
    setOverlayOpacity(0)
    closeTimerRef.current = window.setTimeout(() => {
      setIsVisible(false)
    }, 400)
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [open, isVisible])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!open) return
    resetView()
  }, [open, imageUrl, resetView])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        onNavigate('prev')
      } else if (e.key === 'ArrowRight') {
        onNavigate('next')
      } else if (e.key === 'Escape') {
        onClose()
      } else if (e.key === ' ') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onNavigate, onClose])

  if (!isVisible) return null

  const currentFilePath = filePaths[currentIndex]

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-lg"
      style={{
        opacity: overlayOpacity,
        transition: 'opacity 400ms ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {fromUpload && !isEditorMode && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-10">
          <UiButton
            variant="muted"
            size="sm"
            className="rounded-full px-4 backdrop-blur-xl"
            onClick={onEnterEditor}
            title={t('ui:workspace.actions.reedit')}
          >
            {t('common:edit')}
          </UiButton>
        </div>
      )}

      {isEditorMode && fromUpload ? (
        <div className="w-full h-full">
          <ImageEditor
            imageUrl={imageUrl}
            imageId={imageUrl}
            imageList={imageList}
            currentIndex={currentIndex}
            initialEditState={initialEditState}
            onClose={onExitEditor}
            onSave={(dataUrl, editState) => {
              onSaveEdit(dataUrl, editState)
              onExitEditor()
            }}
            onNavigate={onNavigate}
          />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="absolute inset-0 flex items-center justify-center p-4"
          style={{ overscrollBehavior: 'contain' }}
          onMouseMove={handleContainerMouseMove}
          onMouseUp={handleContainerMouseUp}
          onMouseLeave={handleContainerMouseUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <div className="relative">
            <img
              ref={imageRef}
              src={imageUrl}
              alt={t('ui:viewer.imageAlt')}
              className="select-none image-transition"
              style={{
                opacity: viewerOpacity * overlayOpacity,
                transition: 'opacity 400ms ease',
                transformOrigin: 'center',
                width: '95vw',
                height: '95vh',
                objectFit: 'contain',
              }}
              onLoad={handleImageLoad}
              onMouseDown={handleImageMouseDown}
              onMouseMove={handleImageMouseMove}
              onClick={(e) => {
                if (isPointOnImageContent(e.clientX, e.clientY)) {
                  e.stopPropagation()
                } else {
                  onClose()
                }
              }}
              onContextMenu={(e) => onContextMenu?.(e, currentFilePath)}
              draggable={false}
            />
          </div>

          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
            {imageList.length > 1 && (
              <div className="flex items-center gap-3">
                <UiIconButton
                  onClick={() => onNavigate('prev')}
                  className="rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700/80"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </UiIconButton>
                <UiIconButton
                  onClick={() => onNavigate('next')}
                  className="rounded-full bg-zinc-800/80 text-white hover:bg-zinc-700/80"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </UiIconButton>
              </div>
            )}

            <div className="flex items-center gap-4">
              {imageList.length > 1 && (
                <div className="bg-panel/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50">
                  {currentIndex + 1} / {imageList.length}
                </div>
              )}
              <div
                ref={scaleDisplayRef}
                className="bg-panel/90 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm border border-zinc-700/50"
              >
                100%
              </div>
              <UiButton
                onClick={resetView}
                variant="muted"
                size="sm"
                className="rounded-full px-4 backdrop-blur-xl"
              >
                {t('common:actions.reset')}
              </UiButton>
              <UiButton
                onClick={onClose}
                variant="muted"
                size="sm"
                className="rounded-full px-4 backdrop-blur-xl"
              >
                {t('common:close')}
              </UiButton>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}

