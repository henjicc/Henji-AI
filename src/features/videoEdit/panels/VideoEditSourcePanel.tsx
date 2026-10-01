import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { UiButton, UiEmpty, UiError, UiInput, UiLoading, UiRangeInput } from '@/components/ui'
import AudioPlayer from '@/components/AudioPlayer'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import type { VideoEditInstance } from '../application/videoEditService'
import { requireVideoEditInstance } from '../application/videoEditService'
import { closeVideoEditSource, observeVideoEditSource, readVideoEditSource, registerVideoEditSourcePresenter, subscribeVideoEditSource, updateVideoEditSource, videoEditSourceRevision } from '../application/videoEditSource'
import { createVideoEditSourcePresenter } from './videoEditSourcePresenter'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import type { VideoEditCommandId } from '@/core/videoEdit/commands'

export function VideoEditSourcePanel({ instance, onError, visible = true }: { instance: VideoEditInstance; onError: (error: unknown) => void; visible?: boolean }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEditSource, videoEditSourceRevision)
  const host = useRef<HTMLDivElement>(null)
  const presenterRef = useRef<ReturnType<typeof createVideoEditSourcePresenter> | null>(null)
  const projectId = instance.document.id
  const state = readVideoEditSource(projectId)
  const item = instance.document.items.find(item => item.id === state.itemId)
  const media = instance.document.media.find(media => media.id === item?.mediaId)
  const [draftTime, setDraftTime] = useState('0')
  const editingTime = useRef(false)
  useEffect(() => { if (!editingTime.current) setDraftTime((state.timeUs / 1e6).toFixed(3)) }, [state.timeUs])
  const run = (values: Parameters<typeof updateVideoEditSource>[1]): void => { void updateVideoEditSource(projectId, values).catch(error => {
    if (error instanceof Error && /请求已被更新|预览已关闭/.test(error.message)) return
    onError(error)
  }) }
  const command = (id: VideoEditCommandId): void => { void executeVideoEditCommand(captureVideoEditCommandContext(projectId, 'source'), id).catch(onError) }
  const availability = captureVideoEditCommandContext(projectId, 'source', { includeClipboard: false })
  const enabled = (id: VideoEditCommandId): boolean => videoEditCommandState(availability, id).enabled
  useEffect(() => {
    if (!visible || !host.current) { closeVideoEditSource(projectId); return }
    const presenter = createVideoEditSourcePresenter(host.current, itemId => {
      const document = requireVideoEditInstance(projectId).document
      const item = document.items.find(item => item.id === itemId)
      const media = document.media.find(media => media.id === item?.mediaId)
      if (!media) throw new Error('此项目项没有源文件，请选择视频、图片或音频。')
      return media
    }, (itemId, observation) => observeVideoEditSource(projectId, itemId, observation))
    presenterRef.current = presenter
    const unregister = registerVideoEditSourcePresenter(projectId, presenter.present)
    return () => { presenterRef.current = null; presenter.dispose(); unregister() }
  }, [projectId, visible])
  useEffect(() => { if (state.status === 'closed') presenterRef.current?.release() }, [state.status, state.itemId])
  return <div className="flex h-full min-h-0 flex-col bg-app" aria-label="源监视器" data-video-edit-panel="source" data-video-edit-source-status={state.status} tabIndex={0}>
    <div className="relative min-h-0 flex-1 p-3"><div ref={host} className="absolute inset-3" data-video-edit-source-host />
      {media?.kind === 'audio' && <div className="relative flex h-full items-center"><AudioPlayer src={resolveImageDisplayUrl(media.path)} filePath={media.path} compact surface="plain" active={visible} controlledPlayback={{ currentTime: state.timeUs / 1e6, duration: media.durationSeconds, playing: state.playing, volume: state.volume, disabled: state.status !== 'ready', onTogglePlay: () => command('play_pause'), onSeek: seconds => run({ timeUs: Math.round(seconds * 1e6), playing: false }), onVolume: volume => run({ volume }) }} /></div>}
      {!state.itemId && <UiEmpty title="选择源素材" description="在项目素材中双击视频、图片或音频，独立预览原文件。" />}
    </div>
    {state.itemId && <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
      <span className="min-w-0 flex-1 truncate text-xs text-text-muted">{item?.name}</span>
      {media?.kind === 'video' && <UiButton variant="plain" disabled={!enabled('play_pause')} onClick={() => command('play_pause')}>{state.playing ? '暂停源素材' : '播放源素材'}</UiButton>}
      <UiButton variant="plain" onClick={() => run({ itemId: '', timeUs: 0, playing: false })}>关闭源素材</UiButton>
      {media?.kind !== 'image' && <div className="flex w-full flex-wrap items-center gap-1 text-xs">
        <UiButton variant="plain" disabled={!enabled('play_reverse')} onClick={() => command('play_reverse')}>反向（静音）</UiButton><UiButton variant="plain" disabled={!enabled('play_stop')} onClick={() => command('play_stop')}>停止</UiButton><UiButton variant="plain" disabled={!enabled('play_forward')} onClick={() => command('play_forward')}>正向</UiButton>
        <UiButton variant="plain" disabled={!enabled('mark_in')} onClick={() => command('mark_in')}>设入点</UiButton><UiButton variant="plain" disabled={!enabled('mark_out')} onClick={() => command('mark_out')}>设出点</UiButton>
        <span className="text-text-muted">入 {state.inUs === null ? '未设置' : `${(state.inUs / 1e6).toFixed(3)}s`} · 出 {state.outUs === null ? '未设置' : `${(state.outUs / 1e6).toFixed(3)}s`}</span>
        {state.playing && state.playbackDirection === -1 && <span className="text-text-muted">正在反向静音浏览</span>}
      </div>}
      {media?.kind !== 'image' && <div className="flex w-full items-center gap-2"><UiInput aria-label="源素材定位秒" type="number" min={0} max={media?.durationSeconds ?? 0} step={0.001} className="w-24" value={draftTime} onFocus={() => { editingTime.current = true }} onChange={event => setDraftTime(event.target.value)} onBlur={() => { editingTime.current = false; run({ timeUs: Math.round(Number(draftTime) * 1e6), playing: false }) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} />
        {media?.kind === 'video' && <UiRangeInput aria-label="源素材进度" min={0} max={Math.round((media?.durationSeconds ?? 0) * 1e6)} step={1} value={state.timeUs} onChange={event => run({ timeUs: Number(event.target.value), playing: false })} />}</div>}
      {state.status === 'loading' && <UiLoading message="正在打开源素材…" />}
    </div>}
    {state.error && <UiError message={state.error} />}
  </div>
}
