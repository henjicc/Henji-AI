import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { UiButton, UiError, UiPageHeader, UiRegion } from '@/components/ui'
import { Download, Undo2, Redo2, Scissors, Trash2, Type } from 'lucide-react'
import type { DockviewApi } from 'dockview-react'
import { activeVideoEditInstance, appendVideoEditClip, closeVideoEditProject, createVideoEditProject, deleteVideoEditClip, getActiveVideoEditSequence, listVideoEditInstances, openVideoEditProject, saveVideoEdit, splitSelectedVideoEdit, subscribeVideoEdit, undoVideoEdit, videoEditRevision, focusVideoEdit, setVideoEditView } from './application/videoEditService'
import { cancelVideoEditExport, exportVideoEdit, videoEditExportTask } from './application/videoEditExport'
import { VideoEditDock } from './layout/VideoEditDock'
import { VideoEditLayoutMenu } from './layout/VideoEditDockChrome'
import { isUiInspectionActive } from '@/platform/runtime'

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
  const selected = sequence?.clips.find(clip => clip.id === instance?.selection)
  const task = projectId ? videoEditExportTask(projectId) : undefined
  return <div className="flex h-full min-h-0 flex-col bg-app text-text-dark" onKeyDown={event => {
    if (!projectId || (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]'))) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); run(() => saveVideoEdit(projectId)) }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); run(() => undoVideoEdit(projectId, event.shiftKey)) }
    if (event.key === 'Delete' && selected) run(() => deleteVideoEditClip(projectId, selected.id))
    if (event.key === ' ' && instance) { event.preventDefault(); setVideoEditView(projectId, { playing: !instance.playing }) }
  }}>
    {instance && sequence ? <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border-dark bg-surface-dark px-3">
        <UiButton variant="plain" onClick={() => run(() => closeVideoEditProject(instance.document.id))}>关闭工程</UiButton>
        <span className="max-w-40 truncate text-sm" data-observation-sensitive>{instance.document.name}</span>
        <UiButton variant="plain" className="gap-1.5" disabled={!instance.past.length} onClick={() => run(() => undoVideoEdit(instance.document.id))}><Undo2 size={15} />撤销</UiButton>
        <UiButton variant="plain" className="gap-1.5" disabled={!instance.future.length} onClick={() => run(() => undoVideoEdit(instance.document.id, true))}><Redo2 size={15} />重做</UiButton>
        <UiButton variant="plain" className="gap-1.5" disabled={!selected} onClick={() => run(() => splitSelectedVideoEdit(instance.document.id))}><Scissors size={15} />拆分</UiButton>
        <UiButton variant="plain" className="gap-1.5" disabled={!selected} onClick={() => selected && run(() => deleteVideoEditClip(instance.document.id, selected.id))}><Trash2 size={15} />删除</UiButton>
        <UiButton variant="plain" className="gap-1.5" onClick={() => run(() => appendVideoEditClip(instance.document.id))}><Type size={15} />文字</UiButton>
        <VideoEditLayoutMenu api={dockApi} />
        <div className="ml-auto" />
        <span className="mr-2 text-2xs tabular-nums text-text-faint">{sequence.width} × {sequence.height} · {Number(sequence.fps.toFixed(3))}fps</span>
        {task?.state === 'running' ? <UiButton variant="plain" onClick={() => cancelVideoEditExport(instance.document.id)}>取消导出 {Math.round(task.progress * 100)}%</UiButton> : <UiButton variant="primary" className="gap-2" disabled={!sequence.clips.length} onClick={() => run(() => exportVideoEdit(instance.document.id))}><Download size={16} />导出视频</UiButton>}
      </div>
      <div className="min-h-0 flex-1" aria-label="剪辑面板工作区"><VideoEditDock instance={instance} onError={onError} onApiChange={setDockApi} /></div>
    </> : <UiRegion className="m-auto max-w-3xl">
      <UiPageHeader title="剪辑" description="从本地素材开始创作，将可编辑工程保存在自己的磁盘上。" />
      <div className="my-5 flex gap-3"><UiButton variant="primary" onClick={() => run(createVideoEditProject)}>新建工程</UiButton><UiButton variant="ghost" onClick={() => run(() => openVideoEditProject())}>打开工程</UiButton></div>
      {listVideoEditInstances().map(item => <UiButton key={item.document.id} variant="plain" onClick={() => focusVideoEdit(item.document.id)}>{item.document.name}</UiButton>)}
    </UiRegion>}
    {(error || instance?.error) && <UiError message={error || instance?.error || ''} />}
  </div>
}
