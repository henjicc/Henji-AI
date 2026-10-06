import { useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { Dropdown, UiButton, UiError, UiLoading } from '@/components/ui'
import type { CodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { openAssetLibrary } from '@/stores/navigationStore'
import { acceptsVideoEditDrop, readVideoEditDrop } from '../application/videoEditDrop'
import { bindVideoEditCodeImage, chooseVideoEditCodeImage, type VideoEditCodeImageBinding } from '../application/videoEditCodeImages'
import type { VideoEditCodeTarget } from '../application/videoEditCodeParameters'
import { requireVideoEditInstance } from '../application/videoEditService'

export function CodeImageParameterControl({ target, parameterKey, title, value }: { target: VideoEditCodeTarget; parameterKey: string; title: string; value: CodeImageReference | null }): React.ReactElement {
  const pending = useRef<AbortController>()
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scope = JSON.stringify([target.projectId, target.sequenceId, target.clipId, target.versionId, parameterKey])
  useLayoutEffect(() => {
    mounted.current = true
    setBusy(false); setError(null)
    return () => { mounted.current = false; pending.current?.abort(); pending.current = undefined }
  }, [scope])
  const cancel = (): void => { pending.current?.abort(); pending.current = undefined; if (mounted.current) setBusy(false) }
  const run = async (operation: (signal: AbortSignal) => Promise<void>): Promise<void> => {
    if (!mounted.current) return
    cancel()
    const controller = new AbortController(); pending.current = controller
    setError(null); setBusy(true)
    try { await operation(controller.signal) } catch (reason) {
      if (mounted.current && pending.current === controller && !controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : '图片未能应用，请重新选择。')
      }
    } finally {
      if (mounted.current && pending.current === controller) { pending.current = undefined; setBusy(false) }
    }
  }
  const bind = (input: VideoEditCodeImageBinding): void => { void run(signal => bindVideoEditCodeImage(target, parameterKey, input, signal)) }
  const images = requireVideoEditInstance(target.projectId).document.media.filter(media => media.kind === 'image')
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault(); event.stopPropagation()
    try {
      const input = readVideoEditDrop(event.dataTransfer)
      if (input.kind === 'items') {
        if (input.projectId !== target.projectId) throw new Error('请拖入当前剪辑的图片，或从资产库选择。')
        if (input.itemIds.length !== 1) throw new Error('请一次拖入一张图片。')
        const document = requireVideoEditInstance(target.projectId).document
        const item = document.items.find(item => item.id === input.itemIds[0])
        if (item?.kind !== 'image' || !item.mediaId || !images.some(media => media.id === item.mediaId)) throw new Error('此参数只接受图片。')
        bind({ kind: 'media', mediaId: item.mediaId })
      } else if (input.kind === 'sources') {
        if (input.sources.length !== 1) throw new Error('请一次拖入一张图片。')
        const source = input.sources[0]
        // Asset identity is authoritative; a drag payload cannot substitute its original path.
        if (source.assetId) bind({ kind: 'asset', assetId: source.assetId })
        else if (source.path) bind({ kind: 'file', path: source.path })
        else throw new Error('请引用素材库图片或本地图片文件。')
      } else throw new Error('此参数只接受图片，不能绑定音视频选区。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法识别拖入的图片。') }
  }
  return <div className="flex flex-col gap-2" aria-label={`${title}图片拖放区`} data-video-edit-code-image={parameterKey} onDrop={drop} onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' } }}>
    <Dropdown ariaLabel={`${title}素材图片`} value={value?.mediaId ?? ''} options={[{ value: '', label: '未绑定图片' }, ...images.map(media => ({ value: media.id, label: media.name }))]} disabled={busy} onSelect={mediaId => bind(mediaId ? { kind: 'media', mediaId } : null)} />
    <div className="flex flex-wrap items-center gap-2">
      <UiButton variant="secondary" disabled={busy} onClick={() => { void run(signal => chooseVideoEditCodeImage(target, parameterKey, signal)) }}>选择文件</UiButton>
      <UiButton variant="secondary" onClick={() => openAssetLibrary('floating')}>从资产库拖入</UiButton>
      <UiButton disabled={!value || busy} onClick={() => bind(null)}>清除图片</UiButton>
      {busy && <UiButton onClick={cancel}>取消选择</UiButton>}
    </div>
    {busy && <UiLoading size="xs" message="正在应用图片" />}
    {error && <UiError size="xs" align="start" title={error} message="" />}
  </div>
}
