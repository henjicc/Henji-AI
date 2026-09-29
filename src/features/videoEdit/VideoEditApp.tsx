import { useCallback, useState, useSyncExternalStore } from 'react'
import { UiButton, UiEmpty, UiError, UiGroup, UiInput, UiModal, UiPageHeader, UiRegion } from '@/components/ui'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { activeVideoEditInstance, appendVideoEditClip, closeVideoEditProject, createVideoEditProject, deleteVideoEditClip, editVideoProject, listVideoEditInstances, openVideoEditProject, saveVideoEdit, splitSelectedVideoEdit, subscribeVideoEdit, undoVideoEdit, videoEditRevision, focusVideoEdit } from './application/videoEditService'
import { chooseVideoEditMedia, importVideoEditPaths, relinkVideoEditMedia } from './application/videoEditMedia'
import { cancelVideoEditExport, exportVideoEdit, videoEditExportTask } from './application/videoEditExport'
import { VideoEditPreview } from './VideoEditPreview'
import { VideoEditTimeline } from './VideoEditTimeline'

const clipNumbers: Array<{ key: keyof Pick<VideoEditClip, 'start' | 'duration' | 'sourceInUs' | 'track' | 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume' | 'brightness'>; label: string; step: number }> = [
  { key: 'start', label: '开始帧', step: 1 }, { key: 'duration', label: '时长帧', step: 1 }, { key: 'sourceInUs', label: '源入点（秒）', step: 0.001 }, { key: 'track', label: '轨道', step: 1 },
  { key: 'x', label: '水平位置', step: 0.01 }, { key: 'y', label: '垂直位置', step: 0.01 }, { key: 'scale', label: '缩放', step: 0.05 }, { key: 'rotation', label: '旋转', step: 1 },
  { key: 'opacity', label: '不透明度', step: 0.05 }, { key: 'volume', label: '音量', step: 0.05 }, { key: 'brightness', label: '亮度效果', step: 0.05 },
]
export default function VideoEditApp(): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  const instance = activeVideoEditInstance()
  const [error, setError] = useState<string | null>(null)
  const [assets, setAssets] = useState<AssetRecord[] | null>(null)
  const [assetPage, setAssetPage] = useState(1)
  const [assetTotal, setAssetTotal] = useState(0)
  const onError = useCallback((reason: unknown): void => { setError(reason instanceof Error ? reason.message : String(reason)) }, [])
  const run = (operation: () => unknown | Promise<unknown>): void => { setError(null); void Promise.resolve().then(operation).catch(onError) }
  const showAssets = async (page = 1): Promise<void> => { const result = await getPlatform().assetLibrary.queryAssets({ page, pageSize: 30 }); setAssets(result.items); setAssetPage(result.page); setAssetTotal(result.total) }
  const projectId = instance?.document.id
  const selected = instance?.document.clips.find(clip => clip.id === instance.selection)
  const task = projectId ? videoEditExportTask(projectId) : undefined
  const updateClip = (key: keyof VideoEditClip, value: string | number): void => { if (projectId && selected) run(() => editVideoProject(projectId, document => ({ ...document, clips: document.clips.map(clip => clip.id === selected.id ? { ...clip, [key]: value } : clip) }))) }
  return <div className="flex h-full min-h-0 flex-col bg-app text-text-dark" onKeyDown={event => {
    if (!projectId || (event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable=true]'))) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); run(() => saveVideoEdit(projectId)) }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); run(() => undoVideoEdit(projectId, event.shiftKey)) }
    if (event.key === 'Delete' && selected) run(() => deleteVideoEditClip(projectId, selected.id))
  }}>
    {instance ? <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border-dark bg-surface-dark px-3">
        <UiButton variant="plain" onClick={() => run(() => closeVideoEditProject(instance.document.id))}>关闭工程</UiButton>
        <span className="max-w-40 truncate text-sm" data-observation-sensitive>{instance.document.name}{instance.dirty ? ' *' : ''}</span>
        <UiButton variant="plain" onClick={() => run(() => saveVideoEdit(instance.document.id))}>保存</UiButton>
        <UiButton variant="plain" disabled={!instance.past.length} onClick={() => run(() => undoVideoEdit(instance.document.id))}>撤销</UiButton>
        <UiButton variant="plain" disabled={!instance.future.length} onClick={() => run(() => undoVideoEdit(instance.document.id, true))}>重做</UiButton>
        <UiButton variant="plain" disabled={!selected} onClick={() => run(() => splitSelectedVideoEdit(instance.document.id))}>拆分</UiButton>
        <UiButton variant="plain" disabled={!selected} onClick={() => selected && run(() => deleteVideoEditClip(instance.document.id, selected.id))}>删除</UiButton>
        <UiButton variant="plain" onClick={() => run(() => appendVideoEditClip(instance.document.id))}>文字</UiButton>
        <div className="ml-auto" />
        {task?.state === 'running' ? <UiButton variant="plain" onClick={() => cancelVideoEditExport(instance.document.id)}>取消导出 {Math.round(task.progress * 100)}%</UiButton> : <UiButton variant="primary" disabled={!instance.document.clips.length} onClick={() => run(() => exportVideoEdit(instance.document.id))}>导出视频</UiButton>}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 overflow-auto bg-panel p-3">
          <UiGroup title="素材">
            <div className="flex flex-wrap gap-1"><UiButton variant="plain" onClick={() => run(() => chooseVideoEditMedia(instance.document.id))}>导入文件</UiButton><UiButton variant="plain" onClick={() => run(() => showAssets())}>素材库</UiButton></div>
            {instance.document.media.map(media => <div key={media.id} className="py-2">
              <UiButton variant="plain" className="w-full truncate text-left" title="添加到播放头位置" onClick={() => run(() => appendVideoEditClip(instance.document.id, media.id))}>{media.name}</UiButton>
              <UiButton variant="plain" className="text-2xs" onClick={() => run(() => relinkVideoEditMedia(instance.document.id, media.id))}>重新定位</UiButton>
            </div>)}
          </UiGroup>
        </aside>
        <VideoEditPreview instance={instance} onError={onError} />
        <aside className="w-56 shrink-0 overflow-auto bg-panel p-3">
          {selected ? <UiGroup title="片段属性">
            <UiInput aria-label="片段名称" value={selected.name} onChange={event => updateClip('name', event.target.value)} />
            {selected.kind === 'text' && <UiInput aria-label="画面文字" value={selected.text} onChange={event => updateClip('text', event.target.value)} />}
            {clipNumbers.map(({ key, label, step }) => <label key={key} className="flex items-center gap-2 py-1 text-xs"><span className="w-24 shrink-0">{label}</span><UiInput aria-label={label} type="number" className="min-w-0" step={step} value={key === 'sourceInUs' ? selected[key] / 1e6 : selected[key]} onChange={event => { if (event.target.value !== '') updateClip(key, key === 'sourceInUs' ? Math.round(Number(event.target.value) * 1e6) : Number(event.target.value)) }} /></label>)}
          </UiGroup> : <UiEmpty title="选择片段以编辑" />}
          <UiGroup title="标注">
            {instance.document.annotations.map(mark => <div key={mark.id} className="py-1 text-xs"><UiInput aria-label="编辑标注文字" value={mark.text} onChange={event => run(() => editVideoProject(instance.document.id, document => ({ ...document, annotations: document.annotations.map(item => item.id === mark.id ? { ...item, text: event.target.value } : item) })))} /><UiButton variant="plain" onClick={() => run(() => editVideoProject(instance.document.id, document => ({ ...document, annotations: document.annotations.filter(item => item.id !== mark.id) })))}>删除标注</UiButton></div>)}
          </UiGroup>
        </aside>
      </div>
      <VideoEditTimeline instance={instance} onError={onError} />
    </> : <UiRegion className="m-auto max-w-3xl">
      <UiPageHeader title="剪辑" description="从本地素材开始创作，将可编辑工程保存在自己的磁盘上。" />
      <div className="my-5 flex gap-3"><UiButton variant="primary" onClick={() => run(createVideoEditProject)}>新建工程</UiButton><UiButton variant="ghost" onClick={() => run(() => openVideoEditProject())}>打开工程</UiButton></div>
      {listVideoEditInstances().map(item => <UiButton key={item.document.id} variant="plain" onClick={() => focusVideoEdit(item.document.id)}>{item.document.name}</UiButton>)}
    </UiRegion>}
    {(error || instance?.error) && <UiError message={error || instance?.error || ''} />}
    <UiModal isOpen={assets !== null} title="从素材库引用" onClose={() => setAssets(null)}>
      <div className="grid grid-cols-2 gap-2">{assets?.map(asset => <UiButton key={asset.id} variant="plain" onClick={() => { if (projectId) run(async () => { await importVideoEditPaths(projectId, [asset.filePath]); setAssets(null) }) }}>{asset.displayName}</UiButton>)}</div>
      <div className="mt-3 flex gap-2"><UiButton variant="plain" disabled={assetPage <= 1} onClick={() => run(() => showAssets(assetPage - 1))}>上一页</UiButton><UiButton variant="plain" disabled={assetPage * 30 >= assetTotal} onClick={() => run(() => showAssets(assetPage + 1))}>下一页</UiButton></div>
    </UiModal>
  </div>
}
