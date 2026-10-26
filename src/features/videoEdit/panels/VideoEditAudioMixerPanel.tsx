import { useMemo, useRef } from 'react'
import { Headphones, Volume2, VolumeX } from 'lucide-react'
import { PanelTrigger, UiButton, UiEmpty, UiIconButton, UiRangeInput, UI_TEXT_META_CLASS } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { AudioEffectPicker, AudioEffectSlots, type AudioRackGesture } from '@/components/audio/AudioEffectRack'
import { createAudioRackEffect, type AudioRackEffect } from '@/core/audio/effects/rackEffect'
import { VIDEO_EDIT_MAX_BUS_EFFECTS, type VideoEditSequence } from '@/core/videoEdit/document'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { createVideoEditMixWriter } from '../application/videoEditAudioMixer'
import { updateVideoEditTrack } from '../application/videoEditTimeline'
import { getActiveVideoEditSequence, type VideoEditInstance } from '../application/videoEditService'

/*
 * 音轨混合器（参照 Audition / PR）：每条音频轨道一列——轨道效果、声像、静音与独奏、推子、音量读数；最右边是主轨。
 * 推子与读数都能拖动（实时试听，松手一步撤销）；推子拉到底（-60 dB）就是静音。作用在这条轨道混好的声音上，预览与导出一致。
 */

const MIN_DB = -60, MAX_DB = 12
const panText = (pan: number): string => pan === 0 ? '居中' : pan < 0 ? `左 ${Math.round(-pan)}` : `右 ${Math.round(pan)}`

/** 一次拖动（推子、读数）合成一步撤销：开始时进手势，松手提交，按 Esc 取消。 */
function useDrag(gesture: AudioRackGesture) {
  const active = useRef<{ finish: () => void; cancel: () => void } | null>(null)
  return {
    begin: () => { if (!active.current) active.current = gesture() },
    end: (cancelled = false) => { const current = active.current; active.current = null; if (cancelled) current?.cancel(); else current?.finish() },
  }
}

function Fader({ label, value, disabled, onChange, gesture }: { label: string; value: number; disabled: boolean; onChange: (volumeDb: number) => void; gesture: AudioRackGesture }): React.ReactElement {
  const drag = useDrag(gesture)
  return <div className="relative mx-auto h-36 w-7" data-video-edit-mixer-fader>
    {/* 纵向推子：把同一个滑杆连同 144 宽的外框转 90 度，上大下小（宽度给外框，滑杆自身保持铺满）。 */}
    <div className="absolute left-1/2 top-1/2 flex w-36 -translate-x-1/2 -translate-y-1/2 -rotate-90 items-center">
      <UiRangeInput aria-label={`${label}音量推子`} min={MIN_DB} max={MAX_DB} step={0.5} value={value} disabled={disabled}
        onPointerDown={() => drag.begin()} onPointerUp={() => drag.end()} onPointerCancel={() => drag.end(true)}
        onDoubleClick={() => onChange(0)} onChange={event => onChange(Number(event.target.value))} />
    </div>
  </div>
}

function Strip({ title, effects, volumeDb, pan, muted, solo, disabled, onEffects, onVolume, onPan, onMute, onSolo, gesture, master = false }: {
  title: string; effects: readonly AudioRackEffect[]; volumeDb: number; pan?: number; muted?: boolean; solo?: boolean; disabled: boolean; master?: boolean
  onEffects: (next: AudioRackEffect[]) => void; onVolume: (volumeDb: number) => void; onPan?: (pan: number) => void; onMute?: () => void; onSolo?: () => void; gesture: AudioRackGesture
}): React.ReactElement {
  const scrub = useDrag(gesture)
  const active = effects.filter(effect => effect.enabled).length
  return <div className={`flex w-28 shrink-0 flex-col gap-2 px-2 py-2 ${master ? 'border-l border-gap' : ''}`} role="group" aria-label={`${title}混音`} data-video-edit-mixer-strip={master ? 'master' : title}>
    <div className="truncate text-center text-xs font-medium text-text1" title={title}>{title}</div>
    <PanelTrigger panelSize="compact" panelPadding="content" alignment="bottomLeft" renderPanel={() => <div className="flex w-72 flex-col gap-1">
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-text2">{title} · 效果</span>
        <AudioEffectPicker disabled={disabled || effects.length >= VIDEO_EDIT_MAX_BUS_EFFECTS} disabledReason={`最多放 ${VIDEO_EDIT_MAX_BUS_EFFECTS} 个效果`} onPick={definition => onEffects([...effects, createAudioRackEffect(definition)])} /></div>
      <AudioEffectSlots effects={effects} disabled={disabled} gesture={gesture} onChange={onEffects} empty={<p className={`m-0 py-2 ${UI_TEXT_META_CLASS}`}>点加号给{master ? '主轨' : '这条轨道'}加效果，作用在{master ? '所有轨道' : '这条轨道'}混好的声音上。</p>} />
    </div>}>
      {({ open, togglePanel }) => <UiButton size="sm" variant={active ? 'secondary' : 'quiet'} className="w-full" aria-expanded={open} tooltip={master ? '主轨效果' : '轨道效果'} onClick={togglePanel}>{active ? `效果 ${active}` : '效果'}</UiButton>}
    </PanelTrigger>
    {onPan ? <div className="flex flex-col items-stretch gap-0.5">
      <NumberInput ariaLabel={`${title}声像`} size="sm" min={-100} max={100} step={1} precision={0} align="center" defaultValue={0} disabled={disabled} value={pan ?? 0}
        onScrubStart={() => scrub.begin()} onScrubEnd={cancelled => scrub.end(cancelled)} onChange={onPan} />
      <span className="text-center text-2xs text-text3">声像 · {panText(pan ?? 0)}</span>
    </div> : <div className="h-11" aria-hidden />}
    <div className="flex justify-center gap-1">
      {onMute && <UiIconButton size="xs" on={muted} aria-pressed={muted} tooltip={muted ? '取消静音' : '静音'} aria-label={`${title}静音`} disabled={disabled} onClick={onMute}>{muted ? <VolumeX /> : <Volume2 />}</UiIconButton>}
      {onSolo && <UiIconButton size="xs" on={solo} aria-pressed={solo} tooltip={solo ? '取消独奏' : '独奏'} aria-label={`${title}独奏`} disabled={disabled} onClick={onSolo}><Headphones /></UiIconButton>}
    </div>
    <Fader label={title} value={volumeDb} disabled={disabled} gesture={gesture} onChange={onVolume} />
    <div className="flex flex-col items-stretch gap-0.5">
      <NumberInput ariaLabel={`${title}音量（dB）`} size="sm" min={MIN_DB} max={MAX_DB} step={0.5} precision={1} align="center" defaultValue={0} disabled={disabled} value={volumeDb}
        onScrubStart={() => scrub.begin()} onScrubEnd={cancelled => scrub.end(cancelled)} onChange={onVolume} />
      <span className="text-center text-2xs text-text3">{volumeDb <= MIN_DB ? '静音' : '音量 dB'}</span>
    </div>
  </div>
}

export function VideoEditAudioMixerPanel({ instance, onError }: { instance: VideoEditInstance; onError: (reason: unknown) => void; visible: boolean }): React.ReactElement {
  const projectId = instance.document.id
  const sequence: VideoEditSequence | undefined = instance.activeSequenceId ? getActiveVideoEditSequence(instance) : undefined
  const writer = useMemo(() => createVideoEditMixWriter(projectId), [projectId])
  if (!sequence) return <UiEmpty size="node" title="还没有打开序列" description="打开一个序列后，这里按轨道调音量、声像与效果。" />
  const run = (action: () => void): void => { try { action() } catch (error) { onError(error) } }
  const gesture: AudioRackGesture = () => { try { return writer.gesture() } catch (error) { onError(error); return { finish: () => {}, cancel: () => {} } } }
  const tracks = sequence.tracks.filter(track => track.kind === 'audio').sort((a, b) => a.index - b.index)
  const rack = (effects: VideoEditEffect[] | undefined): AudioRackEffect[] => (effects ?? []).filter(effect => effect.builtin) as AudioRackEffect[]
  return <div className="flex h-full min-h-0 overflow-x-auto overflow-y-auto" data-video-edit-panel="audio_mixer" aria-label="音轨混合器">
    {!tracks.length ? <UiEmpty size="node" title="序列里还没有音频轨道" /> : tracks.map(track => <Strip key={track.id} title={track.name} effects={rack(track.effects)} volumeDb={track.volumeDb ?? 0} pan={sequence.channels === 2 ? track.pan ?? 0 : undefined}
      muted={track.muted} solo={track.solo} disabled={track.locked} gesture={gesture}
      onEffects={effects => run(() => writer.track(sequence.id, track.id, { effects: effects as VideoEditEffect[] }))}
      onVolume={volumeDb => run(() => writer.track(sequence.id, track.id, { volumeDb }))}
      {...(sequence.channels === 2 ? { onPan: (pan: number) => run(() => writer.track(sequence.id, track.id, { pan })) } : {})}
      onMute={() => run(() => updateVideoEditTrack(projectId, sequence.id, track.id, { muted: !track.muted }))}
      onSolo={() => run(() => updateVideoEditTrack(projectId, sequence.id, track.id, { solo: !track.solo }))} />)}
    <div className="flex-1" />
    <Strip master title="主轨" effects={rack(sequence.master?.effects)} volumeDb={sequence.master?.volumeDb ?? 0} disabled={false} gesture={gesture}
      onEffects={effects => run(() => writer.master(sequence.id, { effects: effects as VideoEditEffect[] }))}
      onVolume={volumeDb => run(() => writer.master(sequence.id, { volumeDb }))} />
  </div>
}
