import { videoEditGainMultiplier } from '@/core/videoEdit/loudness'
import { memo, useRef, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { UiButton, UiIconButton } from '@/components/ui'
import { WaveformView } from '@/components/waveform/WaveformView'
import { retryWaveform, useWaveformDataList, type WaveformSourceRef } from '@/hooks/useWaveformData'
import { subscribeVideoEditFirstFrame, videoEditFirstFramePending } from '../engine/videoEditFirstFrameTiming'

/**
 * 时间线片段的波形（任务 2.3）：每个来源一份整段多级峰值，片段可见部分直接从中切片，
 * 滚动与缩放不再按区间重新解码。声道映射片段每条片段声道一个来源，自上而下各占一条。
 */
export const VideoEditClipWaveform = memo(function VideoEditClipWaveform({ projectId, clipId, sources, startSeconds, endSeconds, gainDb, reverse, left, width, visible, lane = 'full', compact = false }: {
  gainDb?: number
  /** 所属工程：只等本工程的首帧。 */
  projectId: string
  clipId: string
  sources: readonly WaveformSourceRef[]
  /** 可见部分在素材绝对时钟上的起止秒。 */
  startSeconds: number
  endSeconds: number
  /** 倒放只反转绘制方向，继续复用源素材的多级峰值与精细采样缓存。 */
  reverse?: boolean
  left: number
  width: number
  visible: boolean
  /** full：铺满片段；lower：带声音的画面片段（未拆分音视频）把波形放在缩略图条下半部。 */
  lane?: 'full' | 'lower'
  /** 片段太窄放不下文字：读取失败时只留警示图标。 */
  compact?: boolean
}) {
  const { t } = useTranslation('ui')
  // 打开或切换序列时先让节目出首帧，再批量读波形（精细波形要现场解码）；已经读过的不再收起，避免切换时闪烁。
  const firstFramePending = useSyncExternalStore(subscribeVideoEditFirstFrame, () => videoEditFirstFramePending(projectId))
  const waveformsAllowed = useRef(false)
  if (!firstFramePending) waveformsAllowed.current = true
  const states = useWaveformDataList(sources, 'full', visible && waveformsAllowed.current)
  const ready = states.length > 0 && states.every(state => state.data)
  const error = states.find(state => state.status === 'error')?.error
  const lanes = ready ? states.reduce((sum, state) => sum + state.data!.pyramid.channelCount, 0) : 0
  return <>
    {ready && <div className={`pointer-events-none absolute bottom-0 flex flex-col ${lane === 'lower' ? 'h-1/2 bg-media-scrim' : 'top-0'}`} data-video-edit-waveform={clipId} data-waveform-lanes={lanes} style={{ left, width }}>
      {states.map((state, index) => <WaveformView key={index} waveform={state} gain={videoEditGainMultiplier(gainDb)} startSeconds={startSeconds} endSeconds={endSeconds} tone="clip" className={`min-h-0 flex-1 ${reverse ? '-scale-x-100' : ''}`} />)}
    </div>}
    {/* 读不出波形的片段叠一层红斜纹，一眼看得出哪段有问题。红层不接指针，片段照常能选、能拖、能修剪；只有重试按钮接事件 */}
    {error && <div className={`ui-hatch-danger pointer-events-none absolute inset-x-0 bottom-0 z-raised flex items-center overflow-hidden ${lane === 'lower' ? 'h-1/2' : 'top-0'}`} data-video-edit-waveform-failed={clipId}>
      <span className="pointer-events-auto flex" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {compact || lane === 'lower'
        ? <UiIconButton size="2xs" tone="bare" tooltip={t('surfaceGrammar.waveformRetry')} aria-label={t('surfaceGrammar.waveformRetry')} onClick={() => sources.forEach(source => retryWaveform(source, 'full'))}><TriangleAlert className="text-danger-text" /></UiIconButton>
        : <UiButton size="sm" tooltip={t('surfaceGrammar.waveformRetry')} aria-label={t('surfaceGrammar.waveformRetry')} onClick={() => sources.forEach(source => retryWaveform(source, 'full'))}><TriangleAlert className="text-danger-text" />{t('surfaceGrammar.waveformFailed')}</UiButton>}
      </span>
    </div>}
  </>
})
