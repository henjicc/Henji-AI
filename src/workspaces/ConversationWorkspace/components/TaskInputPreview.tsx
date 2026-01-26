import React, { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'

export interface TaskInputPreviewProps {
  taskId: string
  inputImages: string[]
  inputVideos: string[]
  uploadedFilePaths?: string[]
  uploadedVideoFilePaths?: string[]
  onOpenImage: (url: string, list: string[], filePaths: string[]) => void
  onOpenVideo: (url: string, filePath?: string) => void
  onStartImageDrag?: (e: React.MouseEvent, imageUrl: string, filePath?: string) => void
  onStartVideoDrag?: (e: React.MouseEvent, videoUrl: string, filePath?: string) => void
  shouldIgnoreClick?: () => boolean
}

export function TaskInputPreview({
  taskId,
  inputImages,
  inputVideos,
  uploadedFilePaths,
  uploadedVideoFilePaths,
  onOpenImage,
  onOpenVideo,
  onStartImageDrag,
  onStartVideoDrag,
  shouldIgnoreClick,
}: TaskInputPreviewProps): JSX.Element | null {
  if (inputImages.length === 0 && inputVideos.length === 0) return null

  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      <StackPreview
        taskId={taskId}
        items={inputImages}
        kind="image"
        filePaths={uploadedFilePaths}
        onOpenImage={onOpenImage}
        onOpenVideo={onOpenVideo}
        onStartImageDrag={onStartImageDrag}
        onStartVideoDrag={onStartVideoDrag}
        shouldIgnoreClick={shouldIgnoreClick}
      />
      <StackPreview
        taskId={taskId}
        items={inputVideos}
        kind="video"
        filePaths={uploadedVideoFilePaths}
        onOpenImage={onOpenImage}
        onOpenVideo={onOpenVideo}
        onStartImageDrag={onStartImageDrag}
        onStartVideoDrag={onStartVideoDrag}
        shouldIgnoreClick={shouldIgnoreClick}
      />
    </div>
  )
}

interface StackPreviewProps {
  taskId: string
  items: string[]
  kind: 'image' | 'video'
  filePaths?: string[]
  onOpenImage: (url: string, list: string[], filePaths: string[]) => void
  onOpenVideo: (url: string, filePath?: string) => void
  onStartImageDrag?: (e: React.MouseEvent, imageUrl: string, filePath?: string) => void
  onStartVideoDrag?: (e: React.MouseEvent, videoUrl: string, filePath?: string) => void
  shouldIgnoreClick?: () => boolean
}

function StackPreview({
  taskId,
  items,
  kind,
  filePaths,
  onOpenImage,
  onOpenVideo,
  onStartImageDrag,
  onStartVideoDrag,
  shouldIgnoreClick,
}: StackPreviewProps): JSX.Element | null {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [fadeIn, setFadeIn] = useState(false)
  const [renderAll, setRenderAll] = useState(false)
  const [renderExtra, setRenderExtra] = useState(false)
  const [extraVisible, setExtraVisible] = useState(false)

  if (items.length === 0) return null

  useEffect(() => {
    if (!expanded) {
      setFadeIn(false)
      const timer = window.setTimeout(() => setRenderAll(false), 200)
      return () => window.clearTimeout(timer)
    }
    setRenderAll(true)
    const raf = requestAnimationFrame(() => setFadeIn(true))
    return () => cancelAnimationFrame(raf)
  }, [expanded])

  const visible = items.slice(0, 3)
  const extra = items.length - visible.length
  const displayItems = renderAll ? items : visible
  const showExtra = renderExtra && extra > 0

  useEffect(() => {
    if (extra <= 0) {
      setRenderExtra(false)
      setExtraVisible(false)
      return
    }
    if (expanded) {
      setExtraVisible(false)
      const timer = window.setTimeout(() => setRenderExtra(false), 200)
      return () => window.clearTimeout(timer)
    }
    setRenderExtra(true)
    const raf = requestAnimationFrame(() => setExtraVisible(true))
    return () => cancelAnimationFrame(raf)
  }, [expanded, extra])

  const base = 48
  const overlap = 12
  const gap = 4
  const collapsedCount = visible.length + (extra > 0 ? 1 : 0)
  const expandedCount = displayItems.length
  const collapsedWidth = base + Math.max(0, collapsedCount - 1) * (base - overlap)
  const expandedWidth = base + Math.max(0, expandedCount - 1) * (base + gap)
  const width = expanded ? expandedWidth : collapsedWidth

  const renderThumb = (item: string, index: number) => {
    const handleClick = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (shouldIgnoreClick?.()) return
      if (kind === 'image') {
        onOpenImage(item, items, filePaths ?? [])
      } else {
        onOpenVideo(item, filePaths?.[index])
      }
    }
    const handleMouseDown = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (kind === 'image') {
        onStartImageDrag?.(e, item, filePaths?.[index])
      } else {
        onStartVideoDrag?.(e, item, filePaths?.[index])
      }
    }
    return (
      <div
        key={`${taskId}-${kind}-${index}`}
        className={`relative w-12 h-12 flex-shrink-0 rounded overflow-hidden border border-zinc-700/50 bg-zinc-800/70 cursor-pointer transition-[margin,opacity] duration-200 ease-out ${
          index === 0 ? '' : (expanded ? 'ml-1' : '-ml-3')
        } ${index >= visible.length ? (fadeIn ? 'opacity-100' : 'opacity-0') : 'opacity-100'}`}
        style={{ zIndex: 20 - index }}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
      >
        {kind === 'image' ? (
          <img
            src={item}
            alt={t('ui:workspace.inputImageAlt', { index: index + 1 })}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <>
            <video src={item} className="w-full h-full object-cover" muted draggable={false} />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative flex items-center overflow-hidden transition-[width] duration-200 ease-out"
      style={{ width }}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {displayItems.map(renderThumb)}
      {showExtra && (
        <div
          className={`absolute top-0 w-12 h-12 flex-shrink-0 rounded border border-zinc-700/50 bg-zinc-800/70 flex items-center justify-center text-xs text-zinc-300 cursor-pointer transition-[opacity,transform] duration-200 ease-out ${
            extraVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-1 pointer-events-none'
          }`}
          style={{ left: collapsedWidth - base, zIndex: 0 }}
          onClick={(e) => {
            e.stopPropagation()
            const nextIndex = visible.length
            if (kind === 'image') {
              onOpenImage(items[nextIndex], items, filePaths ?? [])
            } else {
              onOpenVideo(items[nextIndex], filePaths?.[nextIndex])
            }
          }}
        >
          +{extra}
        </div>
      )}
    </div>
  )
}
