import React from 'react'
import { useI18n } from '@/hooks/useI18n'

export interface TaskInputPreviewProps {
  taskId: string
  inputImages: string[]
  inputVideos: string[]
  uploadedFilePaths?: string[]
  uploadedVideoFilePaths?: string[]
  onOpenImage: (url: string, list: string[], filePaths: string[]) => void
  onOpenVideo: (url: string, filePath?: string) => void
}

export function TaskInputPreview({
  taskId,
  inputImages,
  inputVideos,
  uploadedFilePaths,
  uploadedVideoFilePaths,
  onOpenImage,
  onOpenVideo,
}: TaskInputPreviewProps): JSX.Element | null {
  const { t } = useI18n()

  if (inputImages.length === 0 && inputVideos.length === 0) return null

  return (
    <>
      {inputImages.length > 0 && (
        <div className="flex gap-2 mb-2">
          {inputImages.slice(0, 3).map((url, index) => (
            <div
              key={`${taskId}-input-img-${index}`}
              className="w-16 h-16 rounded cursor-pointer transition-all overflow-hidden border border-zinc-700/50 hover:brightness-75"
              onClick={(e) => {
                e.stopPropagation()
                onOpenImage(url, inputImages, uploadedFilePaths ?? [])
              }}
            >
              <img
                src={url}
                alt={t('ui:workspace.inputImageAlt', { index: index + 1 })}
                className="w-full h-full object-cover rounded"
              />
            </div>
          ))}
          {inputImages.length > 3 && (
            <div
              className="w-16 h-16 rounded bg-zinc-700/50 flex items-center justify-center text-xs cursor-pointer transition-all border border-zinc-700/50 hover:brightness-75"
              onClick={(e) => {
                e.stopPropagation()
                onOpenImage(inputImages[3], inputImages, uploadedFilePaths ?? [])
              }}
            >
              +{inputImages.length - 3}
            </div>
          )}
        </div>
      )}
      {inputVideos.length > 0 && (
        <div className="flex gap-2 mb-2">
          {inputVideos.slice(0, 3).map((video, index) => (
            <div
              key={`${taskId}-input-video-${index}`}
              className="w-16 h-16 rounded cursor-pointer transition-all overflow-hidden border border-zinc-700/50 hover:brightness-75 relative"
              onClick={(e) => {
                e.stopPropagation()
                onOpenVideo(video, uploadedVideoFilePaths?.[index])
              }}
            >
              <video src={video} className="w-full h-full object-cover rounded" muted />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              </div>
            </div>
          ))}
          {inputVideos.length > 3 && (
            <div
              className="w-16 h-16 rounded bg-zinc-700/50 flex items-center justify-center text-xs cursor-pointer transition-all border border-zinc-700/50 hover:brightness-75"
              onClick={(e) => {
                e.stopPropagation()
                onOpenVideo(inputVideos[3], uploadedVideoFilePaths?.[3])
              }}
            >
              +{inputVideos.length - 3}
            </div>
          )}
        </div>
      )}
    </>
  )
}
