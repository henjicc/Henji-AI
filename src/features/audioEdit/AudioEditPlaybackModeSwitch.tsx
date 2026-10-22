import { UiSegmented } from '@/components/ui'
import type { AudioEditXmlTimeline } from '@/core/audioEdit/xml'
import { useAudioEditPlaybackStore } from './store/audioEditPlaybackStore'

export interface AudioEditDelivery { timeline: AudioEditXmlTimeline | null; error: string }

/** 命令带中间的“原始 / 剪后 / XML 交付”试听切换（设计稿把视图切换放在命令带正中）。 */
export function AudioEditPlaybackModeSwitch({ delivery }: { delivery: AudioEditDelivery }) {
  const mode = useAudioEditPlaybackStore((state) => state.mode)
  const setMode = useAudioEditPlaybackStore((state) => state.setMode)
  return <UiSegmented ariaLabel="试听" value={mode} onChange={setMode} options={(['source', 'edited', 'delivery'] as const).map(value => ({ value, label: value === 'source' ? '原始' : value === 'edited' ? '剪后' : 'XML', disabled: value === 'delivery' && !delivery.timeline, ariaLabel: value === 'delivery' ? 'XML 交付' : undefined, title: value === 'delivery' ? delivery.error || 'XML 交付：按 XML 帧网格试听原声，关闭声音处理和自动增益' : undefined }))} />
}
