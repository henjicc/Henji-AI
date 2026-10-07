import { useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { Dropdown, UiButton, UiError, UiLoading, UiOptionButton } from '@/components/ui'
import PanelTrigger from '@/components/ui/PanelTrigger'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import type { CodeImageReference } from '@/core/videoEdit/codeMaterial/contract'
import { openAssetLibrary } from '@/stores/navigationStore'
import { acceptsVideoEditDrop, readVideoEditDrop } from '../application/videoEditDrop'
import { bindVideoEditCodeImage, chooseVideoEditCodeImage, type VideoEditCodeImageBinding } from '../application/videoEditCodeImages'
import type { VideoEditCodeTarget } from '../application/videoEditCodeParameters'
import { requireVideoEditInstance } from '../application/videoEditService'
import { cancelCodeImageGeneration, codeImageGenerationCandidates, codeImageGenerationJobs, codeImageGenerationRevision, retryCodeImageGenerationBinding, subscribeCodeImageGeneration } from '../application/videoEditCodeImageGeneration'
import { CodeImageGenerationPanel } from './CodeImageGenerationPanel'

export function CodeImageParameterControl({ target, parameterKey, title, value }: { target: VideoEditCodeTarget; parameterKey: string; title: string; value: CodeImageReference | null }): React.ReactElement {
  useSyncExternalStore(subscribeCodeImageGeneration, codeImageGenerationRevision)
  const [generationOpen, setGenerationOpen] = useState(false)
  const generationJobs = codeImageGenerationJobs(target, parameterKey)
  const latestJob = generationJobs.at(-1)
  const activeJobs = generationJobs.filter(job => ['generating', 'placing'].includes(job.status))
  const candidates = codeImageGenerationCandidates(target, parameterKey)
  const pending = useRef<AbortController>()
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scope = JSON.stringify([target.projectId, target.sequenceId, target.clipId, target.versionId, target.effectId, parameterKey])
  useLayoutEffect(() => {
    mounted.current = true
    setBusy(false); setError(null); setGenerationOpen(false)
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
      <PanelTrigger key={scope} panelWidth={560} open={generationOpen} onOpenChange={setGenerationOpen} renderPanel={() => <CodeImageGenerationPanel target={target} parameterKey={parameterKey} title={title} onClose={() => setGenerationOpen(false)} />}>
        {({ togglePanel }) => <UiButton variant="secondary" disabled={busy || activeJobs.length > 0} onClick={togglePanel}>生成</UiButton>}
      </PanelTrigger>
      <UiButton variant="secondary" disabled={busy} onClick={() => { void run(signal => chooseVideoEditCodeImage(target, parameterKey, signal)) }}>选择文件</UiButton>
      <UiButton variant="secondary" onClick={() => openAssetLibrary('floating')}>从资产库拖入</UiButton>
      <UiButton disabled={!value || busy} onClick={() => bind(null)}>清除图片</UiButton>
      {busy && <UiButton onClick={cancel}>取消选择</UiButton>}
    </div>
    {candidates.length > 0 && <PanelTrigger label="生成候选" display={`已生成 ${candidates.length} 张`} panelWidth={320} closeOnPanelClick disabled={busy} renderPanel={() => <Virtuoso className="h-60" data={candidates} itemContent={(_, media) => <UiOptionButton variant="menu" active={value?.mediaId === media.id} className="w-full" aria-label={`使用候选${media.name}`} onClick={() => bind({ kind: 'media', mediaId: media.id })}>
      <img src={resolveImageDisplayUrl(media.path)} alt="" className="h-12 w-12 object-contain" /><span className="min-w-0 truncate">{media.name}</span>
    </UiOptionButton>} />} />}
    {activeJobs.map(job => <UiLoading key={job.id} size="xs" message={job.status === 'placing' ? '正在应用生成图片' : `正在生成图片 ${Math.round(Math.max(0, Math.min(100, job.progress)))}%`}><UiButton disabled={Boolean(job.mediaId)} onClick={() => { void cancelCodeImageGeneration(job.id) }}>取消生成</UiButton></UiLoading>)}
    {latestJob?.status === 'failed' && <UiError size="xs" align="start" title="图片生成未完成" message={latestJob.error} actions={<UiButton variant="secondary" onClick={() => { if (latestJob.generated) { try { retryCodeImageGenerationBinding(latestJob.id) } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } } else setGenerationOpen(true) }}>{latestJob.generated ? '应用完成图片' : '再次生成'}</UiButton>} />}
    {busy && <UiLoading size="xs" message="正在应用图片" />}
    {error && <UiError size="xs" align="start" title={error} message="" />}
  </div>
}
