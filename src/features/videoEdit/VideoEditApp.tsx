import { useCallback, useState, useSyncExternalStore } from 'react'
import { UiButton, UiEmpty, UiError, UiGroup, UiInput, UiPageHeader, UiRegion } from '@/components/ui'
import { Download, Save, Undo2, Redo2, Scissors, Trash2, Type } from 'lucide-react'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getPlatform } from '@/platform/runtime'
import type { VideoEditClip } from '@/core/videoEdit/document'
import { ICON_MEDIA_AUDIO, ICON_MEDIA_IMAGE, ICON_MEDIA_VIDEO } from '@/core/theme/icons'
import { writeHenjiDragData } from '@/contexts/dragDataTransfer'
import { assetRecordToDragPayload, writeAssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { acceptsVideoEditDrop, dropVideoEditPaths, videoEditDropPaths } from './application/videoEditDrop'
import { activeVideoEditInstance, appendVideoEditClip, closeVideoEditProject, createVideoEditProject, deleteVideoEditClip, editVideoProject, listVideoEditInstances, openVideoEditProject, saveVideoEdit, splitSelectedVideoEdit, subscribeVideoEdit, undoVideoEdit, videoEditRevision, focusVideoEdit, setVideoEditView } from './application/videoEditService'
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
    if (event.key === ' ' && instance) { event.preventDefault(); setVideoEditView(projectId, { playing: !instance.playing }) }
  }}>
    {instance ? <>
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border-dark bg-surface-dark px-3">
        <UiButton variant="plain" onClick={() => run(() => closeVideoEditProject(instance.document.id))}>关闭工程</UiButton>
        <span className="max-w-40 truncate text-sm" data-observation-sensitive>{instance.document.name}{instance.dirty ? ' *' : ''}</span>
        <UiButton variant="plain" className="gap-1.5" onClick={() => run(() => saveVideoEdit(instance.document.id))}><Save size={15} />保存</UiButton>
        <UiButton variant="plain" className="gap-1.5" disabled={!instance.past.length} onClick={() => run(() => undoVideoEdit(instance.document.id))}><Undo2 size={15} />撤销</UiButton>
        <UiButton variant="plain" className="gap-1.5" disabled={!instance.future.length} onClick={() => run(() => undoVideoEdit(instance.document.id, true))}><Redo2 size={15} />重做</UiButton>
        <UiButton variant="plain" className="gap-1.5" disabled={!selected} onClick={() => run(() => splitSelectedVideoEdit(instance.document.id))}><Scissors size={15} />拆分</UiButton>
        <UiButton variant="plain" className="gap-1.5" disabled={!selected} onClick={() => selected && run(() => deleteVideoEditClip(instance.document.id, selected.id))}><Trash2 size={15} />删除</UiButton>
        <UiButton variant="plain" className="gap-1.5" onClick={() => run(() => appendVideoEditClip(instance.document.id))}><Type size={15} />文字</UiButton>
        <div className="ml-auto" />
        <span className="mr-2 text-2xs tabular-nums text-text-faint">{instance.document.width} × {instance.document.height} · {instance.document.fps}fps</span>
        {task?.state === 'running' ? <UiButton variant="plain" onClick={() => cancelVideoEditExport(instance.document.id)}>取消导出 {Math.round(task.progress * 100)}%</UiButton> : <UiButton variant="primary" className="gap-2" disabled={!instance.document.clips.length} onClick={() => run(() => exportVideoEdit(instance.document.id))}><Download size={16} />导出视频</UiButton>}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-auto bg-panel p-3" aria-label="工程素材"
          onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
          onDrop={event => { if (!acceptsVideoEditDrop(event.dataTransfer)) return; event.preventDefault(); event.stopPropagation(); try { const paths = videoEditDropPaths(event.dataTransfer); run(() => dropVideoEditPaths(instance.document.id, paths)) } catch (error) { onError(error) } }}>
          <UiGroup title="素材">
            <div className="flex flex-wrap gap-1"><UiButton variant="plain" onClick={() => run(() => chooseVideoEditMedia(instance.document.id))}>导入文件</UiButton><UiButton variant="plain" onClick={() => run(() => showAssets())}>素材库</UiButton></div>
            <p className="mt-2 text-2xs leading-relaxed text-text-faint">拖入文件，或将素材拖到时间线。素材保留在原位置。</p>
            {!instance.document.media.length && <UiEmpty title="导入创作素材" description="视频、图片与声音都可以直接拖入。" />}
            {instance.document.media.map(media => {
              const Icon = media.kind === 'audio' ? ICON_MEDIA_AUDIO : media.kind === 'image' ? ICON_MEDIA_IMAGE : ICON_MEDIA_VIDEO
              return <div key={media.id} draggable className="group my-2 cursor-grab rounded-lg bg-app/40 p-2 active:cursor-grabbing"
                onDragStart={event => { writeHenjiDragData(event.dataTransfer, { type: media.kind, imageUrl: resolveImageDisplayUrl(media.path), filePath: media.path, sourceType: 'upload', displayName: media.name }); event.dataTransfer.effectAllowed = 'copy' }}>
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-app text-text-muted">{media.kind === 'image' ? <img src={resolveImageDisplayUrl(media.path)} alt="" draggable={false} className="h-full w-full object-contain" /> : <Icon size={20} />}</div>
                  <div className="min-w-0 flex-1"><UiButton variant="plain" className="w-full justify-start truncate !px-0 text-xs" title="添加到播放头位置" onClick={() => run(() => appendVideoEditClip(instance.document.id, media.id))}>{media.name}</UiButton><p className="text-2xs tabular-nums text-text-faint">{media.kind === 'audio' ? '音频' : `${media.width} × ${media.height}`}{media.durationSeconds ? ` · ${media.durationSeconds.toFixed(1)}s` : ''}</p></div>
                </div>
                <UiButton variant="plain" className="mt-1 text-2xs" onClick={() => run(() => relinkVideoEditMedia(instance.document.id, media.id))}>重新定位</UiButton>
              </div>
            })}
          </UiGroup>
          {assets !== null && <UiGroup title="从素材库引用">
            <UiButton variant="plain" onClick={() => setAssets(null)}>收起素材库</UiButton>
            {assets.map(asset => <div key={asset.id} draggable className="my-1 cursor-grab rounded-lg bg-app/40 px-2" onDragStart={event => writeAssetDragPayload(event.dataTransfer, assetRecordToDragPayload(asset))}>
              <UiButton variant="plain" className="w-full justify-start truncate text-xs" onClick={() => { if (projectId) run(async () => { await importVideoEditPaths(projectId, [asset.filePath]); setAssets(null) }) }}>{asset.displayName}</UiButton>
            </div>)}
            <div className="mt-3 flex gap-2"><UiButton variant="plain" disabled={assetPage <= 1} onClick={() => run(() => showAssets(assetPage - 1))}>上一页</UiButton><UiButton variant="plain" disabled={assetPage * 30 >= assetTotal} onClick={() => run(() => showAssets(assetPage + 1))}>下一页</UiButton></div>
          </UiGroup>}
        </aside>
        <VideoEditPreview instance={instance} onError={onError} />
        <aside className="w-64 shrink-0 overflow-auto bg-panel p-3">
          {selected ? <UiGroup title="片段属性">
            <UiInput aria-label="片段名称" value={selected.name} onChange={event => updateClip('name', event.target.value)} />
            {selected.kind === 'text' && <UiInput aria-label="画面文字" value={selected.text} onChange={event => updateClip('text', event.target.value)} />}
            {(['时间', '画面', '声音'] as const).map(group => {
              const numbers = clipNumbers.filter(({ key }) => group === '时间' ? ['start', 'duration', 'sourceInUs', 'track'].includes(key) : group === '声音' ? key === 'volume' && ['video', 'audio'].includes(selected.kind) : !['start', 'duration', 'sourceInUs', 'track', 'volume'].includes(key) && selected.kind !== 'audio')
              return numbers.length ? <UiGroup key={group} title={group}><div className="grid grid-cols-2 gap-2">{numbers.map(({ key, label, step }) => <label key={key} className="flex min-w-0 flex-col gap-1 text-2xs text-text-muted"><span>{label}</span><UiInput aria-label={label} type="number" className="min-w-0 tabular-nums" step={step} value={key === 'sourceInUs' ? selected[key] / 1e6 : selected[key]} onChange={event => { if (event.target.value !== '') updateClip(key, key === 'sourceInUs' ? Math.round(Number(event.target.value) * 1e6) : Number(event.target.value)) }} /></label>)}</div></UiGroup> : null
            })}
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
  </div>
}
