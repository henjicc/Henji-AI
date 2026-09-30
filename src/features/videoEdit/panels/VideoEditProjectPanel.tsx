import { useState } from 'react'
import { UiButton, UiEmpty, UiGroup } from '@/components/ui'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { getPlatform } from '@/platform/runtime'
import { ICON_MEDIA_AUDIO, ICON_MEDIA_IMAGE, ICON_MEDIA_VIDEO } from '@/core/theme/icons'
import { writeHenjiDragData } from '@/contexts/dragDataTransfer'
import { assetRecordToDragPayload, writeAssetDragPayload } from '@/features/assets/drag/assetDragPayload'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { acceptsVideoEditDrop, dropVideoEditPaths, videoEditDropPaths } from '../application/videoEditDrop'
import { appendVideoEditClip, type VideoEditInstance } from '../application/videoEditService'
import { chooseVideoEditMedia, importVideoEditPaths, relinkVideoEditMedia } from '../application/videoEditMedia'

export function VideoEditProjectPanel({ instance, onError }: { instance: VideoEditInstance; onError: (reason: unknown) => void }): React.ReactElement {
  const [assets, setAssets] = useState<AssetRecord[] | null>(null)
  const [assetPage, setAssetPage] = useState(1)
  const [assetTotal, setAssetTotal] = useState(0)
  const run = (operation: () => unknown | Promise<unknown>): void => { void Promise.resolve().then(operation).catch(onError) }
  const showAssets = async (page = 1): Promise<void> => {
    const result = await getPlatform().assetLibrary.queryAssets({ page, pageSize: 30 })
    setAssets(result.items); setAssetPage(result.page); setAssetTotal(result.total)
  }
  const projectId = instance.document.id
  return <div className="h-full min-h-0 overflow-auto p-3" aria-label="工程素材"
    onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDrop={event => {
      if (!acceptsVideoEditDrop(event.dataTransfer)) return
      event.preventDefault(); event.stopPropagation()
      try { const paths = videoEditDropPaths(event.dataTransfer); run(() => dropVideoEditPaths(projectId, paths)) } catch (error) { onError(error) }
    }}>
    <UiGroup>
      <div className="flex flex-wrap gap-1"><UiButton variant="plain" onClick={() => run(() => chooseVideoEditMedia(projectId))}>导入文件</UiButton><UiButton variant="plain" onClick={() => run(() => showAssets())}>素材库</UiButton></div>
      <p className="mt-2 text-2xs leading-relaxed text-text-faint">拖入文件，或将素材拖到时间线。素材保留在原位置。</p>
      {!instance.document.media.length && <UiEmpty title="导入创作素材" description="视频、图片与声音都可以直接拖入。" />}
      {instance.document.media.map(media => {
        const Icon = media.kind === 'audio' ? ICON_MEDIA_AUDIO : media.kind === 'image' ? ICON_MEDIA_IMAGE : ICON_MEDIA_VIDEO
        return <div key={media.id} draggable className="group my-2 cursor-grab rounded-lg bg-app/40 p-2 active:cursor-grabbing"
          onDragStart={event => { writeHenjiDragData(event.dataTransfer, { type: media.kind, imageUrl: resolveImageDisplayUrl(media.path), filePath: media.path, sourceType: 'upload', displayName: media.name }); event.dataTransfer.effectAllowed = 'copy' }}>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-app text-text-muted">{media.kind === 'image' ? <img src={resolveImageDisplayUrl(media.path)} alt="" draggable={false} className="h-full w-full object-contain" /> : <Icon size={20} />}</div>
            <div className="min-w-0 flex-1"><UiButton variant="plain" className="w-full justify-start truncate !px-0 text-xs" title="添加到播放头位置" onClick={() => run(() => appendVideoEditClip(projectId, media.id))}>{media.name}</UiButton><p className="text-2xs tabular-nums text-text-faint">{media.kind === 'audio' ? '音频' : `${media.width} × ${media.height}`}{media.durationSeconds ? ` · ${media.durationSeconds.toFixed(1)}s` : ''}</p></div>
          </div>
          <UiButton variant="plain" className="mt-1 text-2xs" onClick={() => run(() => relinkVideoEditMedia(projectId, media.id))}>重新定位</UiButton>
        </div>
      })}
    </UiGroup>
    {assets !== null && <UiGroup title="从素材库引用">
      <UiButton variant="plain" onClick={() => setAssets(null)}>收起素材库</UiButton>
      {assets.map(asset => <div key={asset.id} draggable className="my-1 cursor-grab rounded-lg bg-app/40 px-2" onDragStart={event => writeAssetDragPayload(event.dataTransfer, assetRecordToDragPayload(asset))}>
        <UiButton variant="plain" className="w-full justify-start truncate text-xs" onClick={() => run(async () => { await importVideoEditPaths(projectId, [asset.filePath]); setAssets(null) })}>{asset.displayName}</UiButton>
      </div>)}
      <div className="mt-3 flex gap-2"><UiButton variant="plain" disabled={assetPage <= 1} onClick={() => run(() => showAssets(assetPage - 1))}>上一页</UiButton><UiButton variant="plain" disabled={assetPage * 30 >= assetTotal} onClick={() => run(() => showAssets(assetPage + 1))}>下一页</UiButton></div>
    </UiGroup>}
  </div>
}
