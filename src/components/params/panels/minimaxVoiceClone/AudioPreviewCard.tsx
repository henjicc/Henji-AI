import React, { useState } from 'react'
import { UiOptionButton } from '@/components/ui'
import AudioPlayer from '@/components/AudioPlayer'
import { Upload } from 'lucide-react'

interface AudioPreviewCardProps {
  title?: string
  subtitle?: React.ReactNode
  src: string
  filePath?: string
  emptyText: string
  size?: 'default' | 'compact'
  uploadButtonText?: string
  uploadHintText?: string
  headerAction?: React.ReactNode
  contentAction?: React.ReactNode
  playerRightActions?: React.ReactNode
  onUploadClick?: () => void
  onFileDrop?: (file: File) => void
}

export function AudioPreviewCard({
  title,
  subtitle,
  src,
  filePath,
  emptyText,
  size = 'default',
  uploadButtonText,
  uploadHintText,
  headerAction,
  contentAction,
  playerRightActions,
  onUploadClick,
  onFileDrop,
}: AudioPreviewCardProps): JSX.Element {
  const compact = size === 'compact'
  const [dragActive, setDragActive] = useState(false)

  const canDrop = typeof onFileDrop === 'function'
  const showUploadActions = !src && (onUploadClick || canDrop)

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!canDrop) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setDragActive(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!canDrop) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    if (!canDrop || !onFileDrop) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    const droppedFile = event.dataTransfer.files?.[0]
    if (droppedFile) {
      onFileDrop(droppedFile)
    }
  }

  return (
    <div className="rounded-lg border border-border-dark/80 bg-surface-dark/20 p-2.5">
      {(title || subtitle || headerAction) && (
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="text-xs text-zinc-400">{title || ''}</div>
            {subtitle ? <div className="text-xs text-zinc-300">{subtitle}</div> : null}
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
      )}
      {src ? (
        <div>
          {contentAction && <div className="mb-2 flex justify-end">{contentAction}</div>}
          <AudioPlayer
            src={src}
            filePath={filePath}
            rightActions={playerRightActions}
            compact
            waveformWidth={compact ? 236 : 280}
            waveformHeight={compact ? 40 : 58}
            className={`!w-full !max-w-none !rounded-lg !border-border-dark/70 !bg-surface-dark/35 ${compact ? '!p-2.5' : '!p-3'}`}
          />
        </div>
      ) : (
        <div
          className={`rounded-lg border border-dashed px-3 text-center text-xs ${compact ? 'h-[88px]' : 'h-[132px]'} ${dragActive
            ? 'border-accent bg-accent/10 text-accent'
            : 'border-border-dark/70 text-zinc-500'
            }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <span>{emptyText}</span>
            {showUploadActions && (
              <div className="flex items-center gap-2">
                {onUploadClick && (
                  <UiOptionButton
                    type="button"
                    variant="flat"
                    className="!h-[30px] !px-3 !py-1 text-xs leading-none"
                    onClick={() => onUploadClick()}
                  >
                    <Upload className="mr-1 h-3.5 w-3.5" />
                    {uploadButtonText || '上传音频'}
                  </UiOptionButton>
                )}
                {canDrop && (
                  <span className="text-2xs text-zinc-500">
                    {uploadHintText || '或拖放文件到此处'}
                  </span>
                )}
              </div>
            )}
            {contentAction && <div>{contentAction}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
