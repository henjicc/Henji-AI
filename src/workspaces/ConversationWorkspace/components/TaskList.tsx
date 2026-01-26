import React from 'react'
import { useI18n } from '@/hooks/useI18n'
import type { MenuItem } from '@/hooks/useContextMenu'
import { ProgressBar } from '@/components/ui/ProgressBar'
import AudioPlayer from '@/components/AudioPlayer'
import { getModelDisplayName } from '@/utils/modelHelpers'
import type { GenerationTask } from '../types'
import { splitMulti } from '../utils/multiFile'
import { useHistoryDrag } from '../hooks/useHistoryDrag'
import { TaskInputPreview } from './TaskInputPreview'

export interface TaskListProps {
  tasks: GenerationTask[]
  taskProgress: Record<string, number>
  showMenu: (e: React.MouseEvent, items: MenuItem[]) => void
  onDownload: (filePath: string, fromButton?: boolean) => Promise<void>
  onCopyImage: (filePath?: string) => Promise<void>
  onRegenerate: (task: GenerationTask) => Promise<void>
  onReedit: (task: GenerationTask) => void
  onDelete: (taskId: string) => Promise<void>
  onOpenImageViewer: (url: string, list: string[], filePaths?: string[]) => void
  onOpenVideoViewer: (url: string, filePath?: string) => void
}

function iconCopy(): React.ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  )
}

function iconDownload(): React.ReactNode {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
      />
    </svg>
  )
}

export function TaskList({
  tasks,
  taskProgress,
  showMenu,
  onDownload,
  onCopyImage,
  onRegenerate,
  onReedit,
  onDelete,
  onOpenImageViewer,
  onOpenVideoViewer,
}: TaskListProps): JSX.Element {
  const { t, i18n } = useI18n()
  const { startImageDrag, startVideoDrag, shouldIgnoreClick, markContextMenu } = useHistoryDrag()

  const formatDate = (value?: Date): string => {
    if (!value) return ''
    const locale = i18n.language || 'zh-CN'
    return value.toLocaleString(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const handleImageClick = (url: string, list: string[], filePaths: string[]) => {
    if (shouldIgnoreClick()) return
    onOpenImageViewer(url, list, filePaths)
  }

  const handleVideoClick = (url: string, filePath?: string) => {
    if (shouldIgnoreClick()) return
    onOpenVideoViewer(url, filePath)
  }

  if (tasks.length === 0) {
    return (
      <div className="max-w-6xl mx-auto w-[90%] py-20 text-center text-zinc-500">
        {t('history:empty')}
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto w-[90%] space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">{t('history:title')}</h2>
      </div>

      {tasks.map((task) => {
        const modelName = getModelDisplayName(task.model)
        const progressValue = taskProgress[task.id] ?? task.progress
        const typeLabel = task.type === 'image'
          ? t('ui:workspaceToolbar.filter.image')
          : task.type === 'video'
            ? t('ui:workspaceToolbar.filter.video')
            : t('ui:workspaceToolbar.filter.audio')
        const createdAtLabel = task.result?.createdAt ? formatDate(task.result.createdAt) : ''
        const inputImages = task.images ?? []
        const inputVideos = task.videos ?? []

        const renderResult = () => {
          if (task.status === 'queued') {
            return (
              <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg border-2 border-blue-500/30">
                <div className="text-center">
                  <p className="text-blue-400 font-medium">{t('ui:workspace.status.queued')}</p>
                  <p className="text-zinc-400 text-sm mt-2">{t('ui:workspace.status.waiting')}</p>
                </div>
              </div>
            )
          }

          if (task.status === 'pending') {
            return (
              <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg">
                <div className="text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#007eff] mb-2" />
                  <p className="text-zinc-400">{t('ui:workspace.status.preparing')}</p>
                </div>
              </div>
            )
          }

          if (task.status === 'generating') {
            return (
              <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg">
                <div className="text-center w-full px-6">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-[#007eff] mb-3" />
                  <p className="text-zinc-400 mb-3">{t('ui:workspace.status.generating')}</p>
                  {progressValue !== undefined && (
                    <ProgressBar progress={progressValue} className="mt-3" duration={progressValue >= 99 ? 450 : 2800} />
                  )}
                </div>
              </div>
            )
          }

          if (task.status === 'timeout') {
            return (
              <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg border-2 border-yellow-500/30">
                <div className="text-center w-full px-6">
                  <p className="text-yellow-400 mb-2 font-medium">{t('ui:workspace.status.timeout')}</p>
                  <p className="text-zinc-400 text-sm">{t('ui:workspace.status.timeoutHint')}</p>
                </div>
              </div>
            )
          }

          if (task.status === 'error') {
            return (
              <div className="flex items-center justify-center h-64 bg-[#1B1C21] rounded-lg border-2 border-red-500/20">
                <div className="text-center w-full px-6">
                  <p className="text-red-300 font-medium mb-2">{t('common:error')}</p>
                  <p className="text-zinc-300 text-sm break-words">{task.error || t('common:status.failed')}</p>
                </div>
              </div>
            )
          }

          if (task.status !== 'success' || !task.result) return null

          if (task.result.type === 'image') {
            const urls = splitMulti(task.result.url)
            const filePaths = task.result.filePath ? splitMulti(task.result.filePath) : []

            return (
              <div className="flex flex-wrap gap-3">
                {urls.map((url, index) => {
                  const filePath = filePaths[index]
                  return (
                    <div
                      key={`${task.id}-img-${index}`}
                      className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-zinc-700/50 flex items-center justify-center"
                      onClick={() => handleImageClick(url, urls, filePaths)}
                      onContextMenu={(e) =>
                        showMenu(
                          e,
                          [
                            {
                              id: 'copy-image',
                              label: t('common:actions.copy'),
                              icon: iconCopy(),
                              onClick: async () => onCopyImage(filePath),
                              disabled: !filePath,
                            },
                            {
                              id: 'download-image',
                              label: t('common:actions.download'),
                              icon: iconDownload(),
                              onClick: async () => {
                                if (filePath) await onDownload(filePath, false)
                              },
                              disabled: !filePath,
                            },
                          ],
                        )
                      }
                      onMouseDown={(e) => {
                        if (e.button !== 0) return
                        if (!filePath) return
                        e.stopPropagation()
                        startImageDrag(e, url, filePath)
                      }}
                      onContextMenuCapture={() => markContextMenu()}
                    >
                      <img
                        src={url}
                        alt={t('ui:viewer.imageAlt')}
                        className="max-w-full max-h-full object-contain cursor-grab active:cursor-grabbing select-none"
                        draggable={false}
                      />
                    </div>
                  )
                })}
              </div>
            )
          }

          if (task.result.type === 'video') {
            const filePath = task.result.filePath
            return (
              <div
                className="relative w-64 h-64 bg-[#1B1C21] rounded-lg overflow-hidden border border-zinc-700/50 flex items-center justify-center cursor-pointer"
                onClick={() => handleVideoClick(task.result!.url, filePath)}
                onContextMenu={(e) =>
                  showMenu(e, [
                    {
                      id: 'download-video',
                      label: t('common:actions.download'),
                      icon: iconDownload(),
                      onClick: async () => {
                        if (filePath) await onDownload(filePath, false)
                      },
                      disabled: !filePath,
                    },
                  ])
                }
                onMouseDown={(e) => {
                  if (e.button !== 0) return
                  if (!filePath) return
                  e.stopPropagation()
                  startVideoDrag(e, task.result!.url, filePath)
                }}
                onContextMenuCapture={() => markContextMenu()}
              >
                <video src={task.result.url} className="max-w-full max-h-full object-contain" draggable={false} muted preload="metadata" />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="h-10 w-10 rounded-full bg-zinc-900/60 backdrop-blur-sm flex items-center justify-center text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              </div>
            )
          }

          if (task.result.type === 'audio') {
            const filePath = task.result.filePath
            return (
              <AudioPlayer
                src={task.result.url}
                filePath={filePath}
                onContextMenu={(e) =>
                  showMenu(e, [
                    {
                      id: 'download-audio',
                      label: t('common:actions.download'),
                      icon: iconDownload(),
                      onClick: async () => {
                        if (filePath) await onDownload(filePath, false)
                      },
                      disabled: !filePath,
                    },
                  ])
                }
              />
            )
          }

          return null
        }

        return (
          <div key={task.id} className="bg-[#131313]/70 rounded-xl border border-zinc-700/50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <TaskInputPreview
                  taskId={task.id}
                  inputImages={inputImages}
                  inputVideos={inputVideos}
                  uploadedFilePaths={task.uploadedFilePaths}
                  uploadedVideoFilePaths={task.uploadedVideoFilePaths}
                  onOpenImage={handleImageClick}
                  onOpenVideo={handleVideoClick}
                />
                <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words">{task.prompt}</div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                    {typeLabel}
                  </span>
                  <span className="text-xs bg-[#007eff]/20 text-[#66b3ff] px-2 py-1 rounded">
                    {modelName}
                  </span>
                  {task.dimensions && (
                    <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                      {task.dimensions}
                    </span>
                  )}
                  {task.type === 'video' && task.duration && (
                    <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                      {task.duration}
                    </span>
                  )}
                  {task.type === 'audio' && task.duration && (
                    <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                      {task.duration}
                    </span>
                  )}
                  {createdAtLabel && (
                    <span className="text-xs bg-zinc-700/50 px-2 py-1 rounded">
                      {createdAtLabel}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2 flex-shrink-0">
                {task.result?.filePath && (
                  <button
                    onClick={async () => {
                      for (const fp of splitMulti(task.result!.filePath!)) {
                        await onDownload(fp, true)
                      }
                    }}
                    className="p-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300"
                    title={t('common:actions.download')}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </button>
                )}

                <button
                  onClick={() => onRegenerate(task)}
                  className="p-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300"
                  title={t('ui:workspace.actions.regenerate')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>

                <button
                  onClick={() => onReedit(task)}
                  className="p-2 bg-zinc-700/50 hover:bg-zinc-600/50 rounded-lg transition-all duration-300"
                  title={t('ui:workspace.actions.reedit')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>

                <button
                  onClick={() => onDelete(task.id)}
                  className="p-2 bg-red-700/50 hover:bg-red-600/50 rounded-lg transition-all duration-300"
                  title={t('common:delete')}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="pt-3">{renderResult()}</div>
          </div>
        )
      })}
    </div>
  )
}
