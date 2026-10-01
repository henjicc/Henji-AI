import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { UiButton, UiError, UiPageHeader, UiRegion } from '@/components/ui'
import { Download, Undo2, Redo2, Scissors, Trash2, Type } from 'lucide-react'
import type { DockviewApi } from 'dockview-react'
import { activeVideoEditInstance, appendVideoEditClip, closeVideoEditProject, createVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, openVideoEditProject, subscribeVideoEdit, subscribeVideoEditView, videoEditViewRevision, videoEditRevision, focusVideoEdit, focusVideoEditPanel, type VideoEditInstance } from './application/videoEditService'
import { cancelVideoEditExport, videoEditExportTask } from './application/videoEditExport'
import { VideoEditDock } from './layout/VideoEditDock'
import { VideoEditLayoutMenu } from './layout/VideoEditDockChrome'
import { isUiInspectionActive } from '@/platform/runtime'
import { useSettingsStore } from '@/stores/settingsStore'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from './application/videoEditCommands'
import { videoEditKeyboardCommand } from './application/videoEditKeyboard'
import { VideoEditShortcutSettings } from './panels/VideoEditShortcutSettings'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'
import { collectVideoEditOutput } from './application/videoEditOutputs'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { openAssetLibrary } from '@/stores/navigationStore'

function VideoEditToolbar({ instance, api, run }: { instance: VideoEditInstance; api: DockviewApi | null; run: (operation: () => unknown | Promise<unknown>) => void }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditView, videoEditViewRevision)
  const sequence = getActiveVideoEditSequence(instance); const projectId = instance.document.id
  const task = videoEditExportTask(projectId)
  const [collecting, setCollecting] = useState(false)
  const libraryId = useAssetLibraryStore(state => state.libraryId)
  const context = captureVideoEditCommandContext(projectId, 'timeline', { includeClipboard: false })
  const enabled = (id: VideoEditCommandId): boolean => videoEditCommandState(context, id).enabled
  const command = (id: VideoEditCommandId): void => { const current = captureVideoEditCommandContext(projectId, 'timeline'); run(() => executeVideoEditCommand(current, id)) }
  return <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border-dark bg-surface-dark px-3">
    <UiButton variant="plain" onClick={() => run(() => closeVideoEditProject(projectId))}>关闭工程</UiButton>
    <span className="max-w-40 truncate text-sm" data-observation-sensitive>{instance.document.name}</span>
    <UiButton variant="plain" className="gap-1.5" disabled={!enabled('undo')} onClick={() => command('undo')}><Undo2 size={15} />撤销</UiButton>
    <UiButton variant="plain" className="gap-1.5" disabled={!enabled('redo')} onClick={() => command('redo')}><Redo2 size={15} />重做</UiButton>
    <UiButton variant="plain" className="gap-1.5" disabled={!enabled('split')} onClick={() => command('split')}><Scissors size={15} />拆分</UiButton>
    <UiButton variant="plain" className="gap-1.5" disabled={!enabled('delete')} onClick={() => command('delete')}><Trash2 size={15} />删除</UiButton>
    <UiButton variant="plain" className="gap-1.5" onClick={() => run(() => appendVideoEditClip(projectId))}><Type size={15} />文字</UiButton>
    <VideoEditLayoutMenu api={api} /><VideoEditShortcutSettings /><div className="ml-auto" />
    <span className="mr-2 text-2xs tabular-nums text-text-faint">{sequence.width} × {sequence.height} · {Number(sequence.fps.toFixed(3))}fps</span>
    {task?.state === 'completed' && task.output && <UiButton variant="plain" disabled={collecting} onClick={() => run(async () => {
      setCollecting(true)
      try {
        const asset = await collectVideoEditOutput(task.output!, libraryId ? { libraryId } : {})
        if (activeVideoEditInstance() === instance) { useAssetLibraryStore.getState().setSelectedAsset(asset); openAssetLibrary('floating') }
      } finally { setCollecting(false) }
    })}>{collecting ? '正在收录成片…' : '成片加入资产库'}</UiButton>}
    {task?.state === 'running' ? <UiButton variant="plain" onClick={() => cancelVideoEditExport(projectId)}>取消导出 {Math.round(task.progress * 100)}%</UiButton> : <UiButton variant="primary" className="gap-2" disabled={!enabled('export')} onClick={() => command('export')}><Download size={16} />导出视频</UiButton>}
  </div>
}

export default function VideoEditApp(): React.ReactElement {
  useEffect(() => { if (isUiInspectionActive()) void import('./engine/videoEditCodeProbe') }, [])
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const instance = activeVideoEditInstance()
  const [error, setError] = useState<string | null>(null)
  const [dockApi, setDockApi] = useState<DockviewApi | null>(null)
  const onError = useCallback((reason: unknown): void => { setError(reason instanceof Error ? reason.message : String(reason)) }, [])
  const run = (operation: () => unknown | Promise<unknown>): void => { setError(null); void Promise.resolve().then(operation).catch(onError) }
  const projectId = instance?.document.id
  const sequence = instance ? getActiveVideoEditSequence(instance) : undefined
  const focusPanel = (target: EventTarget | null): void => {
    const panel = target instanceof HTMLElement ? target.closest<HTMLElement>('[data-video-edit-panel]')?.dataset.videoEditPanel : undefined
    if (projectId && panel && ['timeline', 'program', 'source', 'project', 'effects', 'content'].includes(panel) && panel !== instance?.activePanel) focusVideoEditPanel(projectId, panel as NonNullable<typeof instance>['activePanel'])
  }
  const shortcuts = useSettingsStore(state => state.videoEditShortcuts)
  return <div className="flex h-full min-h-0 flex-col bg-app text-text-dark" onFocusCapture={event => focusPanel(event.target)} onPointerDownCapture={event => focusPanel(event.target)} onKeyDown={event => {
    const binding = videoEditKeyboardCommand({ ...event.nativeEvent, code: event.code, key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, isComposing: event.nativeEvent.isComposing, defaultPrevented: event.defaultPrevented, target: event.target }, instance?.activePanel ?? 'global', shortcuts)
    if (!binding) return
    const context = captureVideoEditCommandContext(projectId, binding.scope)
    if (!videoEditCommandState(context, binding.id).enabled) return
    event.preventDefault(); event.stopPropagation(); run(() => executeVideoEditCommand(context, binding.id))
  }}>
    {instance && sequence ? <>
      <VideoEditToolbar instance={instance} api={dockApi} run={run} />
      <div className="min-h-0 flex-1" aria-label="剪辑面板工作区"><VideoEditDock instance={instance} onError={onError} onApiChange={setDockApi} /></div>
    </> : <UiRegion className="m-auto max-w-3xl">
      <UiPageHeader title="剪辑" description="从本地素材开始创作，将可编辑工程保存在自己的磁盘上。" />
      <div className="my-5 flex gap-3"><UiButton variant="primary" onClick={() => run(createVideoEditProject)}>新建工程</UiButton><UiButton variant="ghost" onClick={() => run(() => openVideoEditProject())}>打开工程</UiButton></div>
      {listVideoEditInstances().map(item => <UiButton key={item.document.id} variant="plain" onClick={() => focusVideoEdit(item.document.id)}>{item.document.name}</UiButton>)}
    </UiRegion>}
    {(error || instance?.error) && <UiError message={error || instance?.error || ''} />}
  </div>
}
