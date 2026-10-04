import { useEffect, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiGroup, UiLoading, UiModal, UiSelect } from '@/components/ui'
import { UI_TEXT_META_CLASS } from '@/components/ui/styleTokens'
import {
  VIDEO_EDIT_MAX_AUDIO_CLIPS, videoEditAudioFormatLabel, videoEditAudioPresetLayout, videoEditAudioPresetOf, videoEditAudioSourceLabel, videoEditAudioWidth,
  videoEditFileAudioLayout, videoEditIsDefaultAudioMapping, videoEditSequentialAudioLayout, videoEditSourceChannels,
  type VideoEditAudioFormat, type VideoEditAudioMapping, type VideoEditAudioPreset, type VideoEditAudioSource, type VideoEditAudioStream,
} from '@/core/videoEdit/audioChannels'
import { ensureVideoEditMediaAudioStreams } from '../application/videoEditMedia'
import { setVideoEditClipAudioMapping, setVideoEditItemAudioChannels } from '../application/videoEditProjectItems'

/**
 * Premiere "Modify > Audio Channels". On project items it sets the clip channel format, the number of audio clips and
 * the source channel of every clip channel for clips placed from now on; on a timeline clip it only reassigns the
 * source channels of that clip (its channel format stays, as in Premiere).
 */
export type VideoEditAudioChannelsTarget =
  | { kind: 'items'; itemIds: string[]; mediaId: string; layout?: VideoEditAudioMapping[] }
  | { kind: 'clip'; sequenceId: string; clipIds: string[]; mediaId: string; mapping?: VideoEditAudioMapping }

const PRESETS: Array<{ value: VideoEditAudioPreset; label: string }> = [{ value: 'file', label: '使用文件' }, { value: 'mono', label: '单声道' }, { value: 'stereo', label: '立体声' }]
const sourceKey = (source: VideoEditAudioSource): string => `${source.stream}:${source.channel}`
/** Every select of the dialog shares one width so their edges line up. */
const SELECT_WIDTH = 'w-48'

export function VideoEditAudioChannelsDialog({ projectId, target, onClose }: { projectId: string; target: VideoEditAudioChannelsTarget; onClose: () => void }): React.ReactElement {
  const [streams, setStreams] = useState<VideoEditAudioStream[]>()
  const [layout, setLayout] = useState<VideoEditAudioMapping[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    ensureVideoEditMediaAudioStreams(projectId, target.mediaId, controller.signal).then(value => {
      setStreams(value)
      setLayout(target.kind === 'items' ? structuredClone(target.layout ?? videoEditFileAudioLayout(value)) : [structuredClone(target.mapping ?? videoEditFileAudioLayout(value.slice(0, 1))[0])])
    }, (reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => controller.abort()
  }, [projectId, target])
  const sources = streams ? videoEditSourceChannels(streams) : []
  const format: VideoEditAudioFormat = layout[0]?.format ?? 'stereo'
  const preset = streams && target.kind === 'items' ? videoEditAudioPresetOf(layout, streams) : 'custom'
  const reshape = (nextFormat: VideoEditAudioFormat, count: number): void => {
    // Keep the clips already assigned; new clips continue through the source channels.
    const fresh = videoEditSequentialAudioLayout(streams!, nextFormat, count)
    setLayout(fresh.map((mapping, index) => nextFormat === format && layout[index] ? layout[index] : mapping))
  }
  const assign = (clip: number, channel: number, key: string): void => {
    const source = sources.find(value => sourceKey(value) === key)
    if (source) setLayout(layout.map((mapping, index) => index === clip ? { ...mapping, sources: mapping.sources.map((value, at) => at === channel ? { ...source } : value) } : mapping))
  }
  const submit = (): void => {
    try {
      if (target.kind === 'items') setVideoEditItemAudioChannels(projectId, target.itemIds, preset === 'file' ? null : layout)
      else setVideoEditClipAudioMapping(projectId, target.sequenceId, target.clipIds, videoEditIsDefaultAudioMapping(layout[0], streams) ? null : layout[0])
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const channelName = (channel: number): string => format === 'mono' ? '单声道' : channel === 0 ? '左' : '右'
  return <UiModal isOpen title="音频声道" onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" disabled={!streams || !layout.length} onClick={submit}>确定</UiButton></>}>
    <div className="space-y-4" data-video-edit-audio-channels={target.kind}>
      {!streams && !error && <UiLoading size="sm" message="正在读取素材的声音…" />}
      {streams && target.kind === 'items' && <>
        <UiFormRow label="预设" inline><div className={SELECT_WIDTH}><UiSelect aria-label="音频声道预设" value={preset} onChange={event => { if (event.target.value !== 'custom') setLayout(videoEditAudioPresetLayout(streams, event.target.value as VideoEditAudioPreset)) }}>
          {PRESETS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          {preset === 'custom' && <option value="custom">自定义</option>}
        </UiSelect></div></UiFormRow>
        <UiFormRow label="片段声道格式" inline><div className={SELECT_WIDTH}><UiSelect aria-label="片段声道格式" value={format} onChange={event => reshape(event.target.value as VideoEditAudioFormat, layout.length)}>
          {(['mono', 'stereo'] as const).map(value => <option key={value} value={value}>{videoEditAudioFormatLabel(value)}</option>)}
        </UiSelect></div></UiFormRow>
        <UiFormRow label="音频片段数量" inline><div className={SELECT_WIDTH}><UiSelect aria-label="音频片段数量" value={layout.length} onChange={event => reshape(format, Number(event.target.value))}>
          {Array.from({ length: VIDEO_EDIT_MAX_AUDIO_CLIPS }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
        </UiSelect></div></UiFormRow>
      </>}
      {streams && target.kind === 'clip' && <UiFormRow label="片段声道格式" inline><span className={UI_TEXT_META_CLASS}>{videoEditAudioFormatLabel(format)}</span></UiFormRow>}
      {streams && <UiGroup title="源声道" divided={target.kind === 'items'}>
        <div className="space-y-2">
          {layout.map((mapping, clip) => Array.from({ length: videoEditAudioWidth(mapping.format) }, (_, channel) => <UiFormRow key={`${clip}:${channel}`} inline label={target.kind === 'items' ? `音频片段 ${clip + 1} · ${channelName(channel)}` : channelName(channel)}>
            <div className={SELECT_WIDTH}><UiSelect aria-label={`${target.kind === 'items' ? `音频片段 ${clip + 1} ` : ''}${channelName(channel)}源声道`} value={sourceKey(mapping.sources[channel])} onChange={event => assign(clip, channel, event.target.value)}>
              {sources.map(source => <option key={sourceKey(source)} value={sourceKey(source)}>{videoEditAudioSourceLabel(source, streams)}</option>)}
            </UiSelect></div>
          </UiFormRow>))}
        </div>
      </UiGroup>}
      {streams && target.kind === 'items' && <p className={UI_TEXT_META_CLASS}>只影响之后放入序列的片段，已在序列中的片段保持不变。</p>}
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}
