import { memo } from 'react'
import { WaveformView } from '@/components/waveform/WaveformView'
import { useWaveformDataList, type WaveformSourceRef } from '@/hooks/useWaveformData'

/**
 * 时间线片段的波形（任务 2.3）：每个来源一份整段多级峰值，片段可见部分直接从中切片，
 * 滚动与缩放不再按区间重新解码。声道映射片段每条片段声道一个来源，自上而下各占一条。
 */
export const VideoEditClipWaveform = memo(function VideoEditClipWaveform({ clipId, sources, startSeconds, endSeconds, reverse, left, width, visible, lane = 'full' }: {
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
}) {
  const states = useWaveformDataList(sources, 'full', visible)
  const ready = states.length > 0 && states.every(state => state.data)
  const error = states.find(state => state.status === 'error')?.error
  const lanes = ready ? states.reduce((sum, state) => sum + state.data!.pyramid.channelCount, 0) : 0
  return <>
    {ready && <div className={`pointer-events-none absolute bottom-0 flex flex-col ${lane === 'lower' ? 'h-1/2 bg-media-scrim' : 'top-0'}`} data-video-edit-waveform={clipId} data-waveform-lanes={lanes} style={{ left, width }}>
      {states.map((state, index) => <WaveformView key={index} waveform={state} startSeconds={startSeconds} endSeconds={endSeconds} tone="clip" className={`min-h-0 flex-1 ${reverse ? '-scale-x-100' : ''}`} />)}
    </div>}
    {error && <span className="pointer-events-none absolute bottom-0 text-2xs text-danger-text" title={error}>波形未能读取</span>}
  </>
})
