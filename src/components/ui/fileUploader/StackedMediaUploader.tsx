import { createLogger } from '@/core/logging'
import React, { useEffect, useRef, useState } from 'react'
import { readFile } from '@/platform/desktopApi'
import { RefreshCw } from 'lucide-react'
import { useDragDrop } from '@/contexts/DragDropContext'
import { useTauriDragDrop } from '@/hooks/useTauriDragDrop'
import { urlToFile } from '@/utils/imageConversion'
import { inferMimeFromPath, isDesktop } from '@/utils/save'
import { UiButton, UiIconButton, UiInput } from '../primitives'
import { UI_UPLOADER_CARD_BORDER_CLASS, UI_UPLOADER_CARD_BORDER_OVERRIDE_CLASS } from '../styleTokens'
import Tooltip from '../Tooltip'
import { useReorderDrag } from './useReorderDrag'
import { useStackedExpand } from './useStackedExpand'
import { useFilePickerExpandLock } from './useFilePickerExpandLock'

const logger = createLogger('components.ui.fileUploader.StackedMediaUploader')

type MediaType = 'image' | 'video' | 'audio'

interface StackedMediaUploaderProps {
  files: string[]
  fileTypes?: MediaType[]
  onUpload: (files: File[]) => Promise<void> | void
  onRemove: (index: number) => void
  onReplace?: (index: number, file: File) => Promise<void> | void
  onReorder?: (from: number, to: number) => void
  onFileClick?: (fileUrl: string, fileList: string[]) => void
  onDragStateChange?: (isDragging: boolean) => void
  accept?: string
  multiple?: boolean
  maxCount?: number
  hideUploadButton?: boolean
  disabled?: boolean
  hintText?: string
  onExpandedChange?: (expanded: boolean) => void
}

function inferVideoMimeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  return 'video/mp4'
}

function inferAudioMimeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  return 'audio/mpeg'
}

function AudioPreviewIcon(): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-8 w-8 text-white/90" fill="none">
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        d="M9 3v18M6 7v10m6-11v12m3-9v6m3-8v10m3-6v2M3 11v2"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function StackedMediaUploader({
  files,
  fileTypes,
  onUpload,
  onRemove,
  onReplace,
  onReorder,
  onFileClick,
  onDragStateChange,
  accept = 'image/*',
  multiple = false,
  maxCount = 1,
  hideUploadButton = false,
  disabled = false,
  hintText,
  onExpandedChange
}: StackedMediaUploaderProps): JSX.Element {
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null)
  const [isHtmlDragging, setIsHtmlDragging] = useState(false)
  const { expanded, hoverCapable, onMouseEnter, onMouseLeave, onToggle, beginExpandLock, endExpandLock } = useStackedExpand()
  const dragCounter = useRef(0)
  const { isDragging: isCustomDragging, dragData, endDrag } = useDragDrop()
  const { isDragging: isTauriDragging, elementRef } = useTauriDragDrop((droppedFiles) => {
    void handleFiles(droppedFiles)
  }, disabled)
  const isDragging = isHtmlDragging || isCustomDragging || isTauriDragging
  const canUploadMore = !maxCount || files.length < maxCount
  const showUploadCard = canUploadMore && !hideUploadButton && !disabled

  const { beginFilePickerLock, resolvePicker } = useFilePickerExpandLock({
    beginExpandLock,
    endExpandLock
  })

  useEffect(() => {
    onExpandedChange?.(expanded)
  }, [expanded, onExpandedChange])

  const {
    dragState,
    itemRefs,
    handleMouseDown
  } = useReorderDrag({
    disabled: disabled || !expanded,
    isCustomDragging,
    files,
    onReorder,
    onDragStateChange,
    onImageClick: onFileClick
  })

  const handleFiles = async (incomingFiles: File[]): Promise<void> => {
    if (disabled || incomingFiles.length === 0) return
    const acceptedFiles = incomingFiles.filter((file) => {
      if (accept === '*') return true
      if (accept === 'image/*') return file.type.startsWith('image/')
      if (accept === 'video/*') return file.type.startsWith('video/')
      if (accept === 'audio/*') return file.type.startsWith('audio/')
      if (accept === 'video/*,image/*') return file.type.startsWith('video/') || file.type.startsWith('image/')
      if (accept === 'video/*,audio/*') return file.type.startsWith('video/') || file.type.startsWith('audio/')
      if (accept === 'image/*,audio/*') return file.type.startsWith('image/') || file.type.startsWith('audio/')
      if (accept === 'video/*,image/*,audio/*') return file.type.startsWith('video/') || file.type.startsWith('image/') || file.type.startsWith('audio/')
      return true
    })
    if (acceptedFiles.length === 0) return

    if (!multiple && acceptedFiles.length > 1) {
      await onUpload([acceptedFiles[0]])
      return
    }

    await onUpload(acceptedFiles)
  }

  const handleUploadChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const nextFiles = event.target.files ? Array.from(event.target.files) : []
    event.currentTarget.value = ''
    resolvePicker(nextFiles.length > 0)
    await handleFiles(nextFiles)
  }

  const handleReplaceChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    if (!onReplace || replaceIndex === null) return
    const nextFile = event.target.files?.[0]
    event.currentTarget.value = ''
    resolvePicker(Boolean(nextFile))
    if (!nextFile) {
      return
    }
    await onReplace(replaceIndex, nextFile)
    setReplaceIndex(null)
  }

  const handleDragEnter = (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current += 1
    setIsHtmlDragging(true)
  }

  const handleDragLeave = (event: React.DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      setIsHtmlDragging(false)
      dragCounter.current = 0
    }
  }

  const handleDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault()
    event.stopPropagation()
    setIsHtmlDragging(false)
    dragCounter.current = 0
    if (disabled) return
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      await handleFiles(Array.from(event.dataTransfer.files))
    }
  }

  const handleCustomDrop = async (): Promise<void> => {
    if (!isCustomDragging || !dragData) return
    if (dragData.type === 'image') {
      try {
        let file: File
        if (dragData.filePath && isDesktop()) {
          const bytes = await readFile(dragData.filePath)
          const mime = inferMimeFromPath(dragData.filePath)
          const blob = new Blob([bytes], { type: mime })
          const filename = dragData.filePath.split(/[\\/]/).pop() || `image-${Date.now()}.jpg`
          file = new File([blob], filename, { type: mime })
        } else {
          file = await urlToFile(dragData.imageUrl, `image-${Date.now()}.jpg`)
        }
        await handleFiles([file])
      } catch (error) {
        logger.error('StackedMediaUploader convert image failed', error)
      }
    }

    if (dragData.type === 'video' && dragData.filePath && isDesktop()) {
      try {
        const bytes = await readFile(dragData.filePath)
        const mime = inferVideoMimeFromPath(dragData.filePath)
        const blob = new Blob([bytes], { type: mime })
        const filename = dragData.filePath.split(/[\\/]/).pop() || `video-${Date.now()}.mp4`
        await handleFiles([new File([blob], filename, { type: mime })])
      } catch (error) {
        logger.error('StackedMediaUploader convert video failed', error)
      }
    }
    if (dragData.type === 'audio' && dragData.filePath && isDesktop()) {
      try {
        const bytes = await readFile(dragData.filePath)
        const mime = inferAudioMimeFromPath(dragData.filePath)
        const blob = new Blob([bytes], { type: mime })
        const filename = dragData.filePath.split(/[\\/]/).pop() || `audio-${Date.now()}.mp3`
        await handleFiles([new File([blob], filename, { type: mime })])
      } catch (error) {
        logger.error('StackedMediaUploader convert audio failed', error)
      }
    }
    endDrag()
  }

  const collapsedVisibleCount = 4
  const collapsedRotations = [-11, -4, 5, 10, -8]
  const expandedRotations = [-7, -3, 2, 6, -5, 4, -2]
  const collapsedStep = 5
  const expandedStep = 42
  const expandedWidth = Math.max(96, Math.min(302, files.length * expandedStep + 50))
  const shellWidth = expanded ? expandedWidth : 64
  const plusCollapsedLeft = 28
  const plusCollapsedTop = 42
  const plusExpandedLeft = Math.max(8, files.length * expandedStep)
  const plusExpandedTop = 4
  const isEmptyState = files.length === 0
  const plusUseCardShape = expanded || isEmptyState
  const plusLeft = plusUseCardShape ? plusExpandedLeft : plusCollapsedLeft
  const plusTop = plusUseCardShape ? plusExpandedTop : plusCollapsedTop
  const plusRotate = isEmptyState ? 0 : (plusUseCardShape ? -2 : 0)
  const plusZIndex = plusUseCardShape
    ? (files.length > 0 ? 0 : 40)
    : 40

  const uploaderContent = (
    <div
      ref={elementRef}
      className="relative shrink-0 transition-[width] duration-250 ease-out"
      style={{ width: shellWidth }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onToggle}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragLeave={handleDragLeave}
      onDrop={(event) => void handleDrop(event)}
      onMouseUp={() => void handleCustomDrop()}
    >
      <div className={`relative min-h-[82px] rounded-2xl bg-zinc-900/28 p-1.5 transition-colors ${isDragging ? 'bg-zinc-800/55' : ''}`}>
        <div className="relative h-[66px] overflow-visible">
          {files.map((file, index) => {
            const isVideo = fileTypes ? fileTypes[index] === 'video' : false
            const isAudio = fileTypes ? fileTypes[index] === 'audio' : accept === 'audio/*'
            const isDraggingThis = dragState.isDragging && dragState.fromIndex === index
            const collapsedRotate = collapsedRotations[index % collapsedRotations.length] ?? 0
            const expandedRotate = expandedRotations[index % expandedRotations.length]
            const collapsedTop = Math.abs(collapsedRotate) > 8 ? 2 : 0
            const collapsedLeft = index * collapsedStep
            const expandedLeft = index * expandedStep
            const collapsedVisible = index < collapsedVisibleCount
            const rotate = expanded ? expandedRotate : collapsedRotate
            const scale = expanded ? 1 : (collapsedVisible ? 1 : 0.92)
            const opacity = expanded ? 1 : (collapsedVisible ? 1 : 0)
            const zIndex = files.length - index

            return (
              <div
                key={`${file}-${index}`}
                ref={(element) => {
                  itemRefs.current[index] = element
                }}
                className="group absolute"
                style={{
                  left: `${expanded ? expandedLeft : collapsedLeft}px`,
                  top: `${expanded ? 4 : collapsedTop}px`,
                  opacity: isDraggingThis ? 0.75 : opacity,
                  transform: `rotate(${rotate}deg) scale(${scale})`,
                  transition: 'left 280ms cubic-bezier(0.15,0.75,0.3,1), top 280ms cubic-bezier(0.15,0.75,0.3,1), transform 280ms cubic-bezier(0.15,0.75,0.3,1), opacity 180ms ease',
                  pointerEvents: expanded || collapsedVisible ? 'auto' : 'none',
                  zIndex
                }}
                onMouseDown={(event) => handleMouseDown(index, event)}
              >
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`relative h-[64px] w-[48px] overflow-hidden rounded-[11px] ${UI_UPLOADER_CARD_BORDER_CLASS} bg-zinc-800/35 p-0 shadow-[0_8px_16px_rgba(0,0,0,0.45)] transition-transform duration-200 ease-out hover:scale-[1.1]`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onFileClick?.(file, files)
                  }}
                >
                  {isAudio ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/75">
                      <AudioPreviewIcon />
                    </div>
                  ) : (
                    <img src={file} alt={`参考 ${index + 1}`} className="absolute inset-0 block h-full w-full object-cover" draggable={false} />
                  )}
                  {isVideo && (
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 text-[10px] text-white">
                      ▶
                    </span>
                  )}
                </UiButton>
                <UiIconButton
                  type="button"
                  className={`absolute -right-1 -top-1 h-5 w-5 border-zinc-500/55 bg-zinc-900/92 p-0 transition-opacity ${expanded ? 'opacity-0 group-hover:opacity-100' : 'pointer-events-none opacity-0'}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove(index)
                  }}
                >
                  ×
                </UiIconButton>
                {onReplace && (
                  <UiIconButton
                    type="button"
                    className={`absolute -bottom-1 -right-1 z-20 h-5 w-5 rounded border-zinc-500/70 bg-zinc-900/95 p-0 transition-opacity ${expanded ? 'opacity-0 group-hover:opacity-100' : 'pointer-events-none opacity-0'}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      beginFilePickerLock()
                      setReplaceIndex(index)
                      replaceInputRef.current?.click()
                    }}
                    title="替换"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-white" strokeWidth={2.3} />
                  </UiIconButton>
                )}
              </div>
            )
          })}

          {showUploadCard && (
            <div
              className="absolute"
              style={{
                left: `${plusLeft}px`,
                top: `${plusTop}px`,
                transform: `rotate(${plusRotate}deg) scale(${plusUseCardShape ? 1 : 0.92})`,
                transition: 'left 280ms cubic-bezier(0.15,0.75,0.3,1), top 280ms cubic-bezier(0.15,0.75,0.3,1), transform 280ms cubic-bezier(0.15,0.75,0.3,1), opacity 180ms ease',
                zIndex: plusZIndex
              }}
            >
              <UiButton
                type="button"
                variant="muted"
                size="sm"
                className={`p-0 text-zinc-100 ${plusUseCardShape
                  ? `h-[64px] w-[48px] rounded-[11px] ${UI_UPLOADER_CARD_BORDER_OVERRIDE_CLASS} !bg-zinc-900 text-2xl shadow-[0_8px_18px_rgba(0,0,0,0.38)] transition-transform duration-200 ease-out hover:scale-[1.1]`
                  : 'h-[29px] w-[29px] aspect-square !rounded-full border-zinc-500/55 bg-zinc-700/82 text-base shadow-[0_6px_14px_rgba(0,0,0,0.42)] transition-transform duration-200 ease-out hover:scale-[1.1]'
                  }`}
                onClick={(event) => {
                  event.stopPropagation()
                  beginFilePickerLock()
                  uploadInputRef.current?.click()
                }}
              >
                +
              </UiButton>
            </div>
          )}
        </div>

        {!hoverCapable && (
          <div className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-zinc-500">
            点按展开
          </div>
        )}
      </div>

      <UiInput
        ref={uploadInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={disabled}
        onChange={(event) => void handleUploadChange(event)}
      />
      <UiInput
        ref={replaceInputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(event) => void handleReplaceChange(event)}
      />
    </div>
  )

  if (!hintText) {
    return uploaderContent
  }

  return (
    <Tooltip
      content={<span className="block text-zinc-300">{hintText}</span>}
      delay={250}
      className="bg-zinc-950/95 border-zinc-600/70 shadow-2xl"
    >
      {uploaderContent}
    </Tooltip>
  )
}
