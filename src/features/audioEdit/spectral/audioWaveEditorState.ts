import React from 'react'
import type { AudioEditGainRegion, AudioEditRepair } from '@/core/audioEdit/regions'
import type { AudioEditProjectDocument, AudioEditRange } from '@/core/audioEdit/types'
import { repairAudioEditRegion, setAudioEditRegions } from '../application/audioEditRegions'
import type { WaveformViewport } from '../waveformViewport'
import { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'
import { readAudioEditViewMemory, writeAudioEditViewMemory } from '../workspace/audioEditViewMemory'
import type { AudioEditorDisplay } from './AudioSpectralEditor'
import { strokeBounds, type AudioBrushStroke, type AudioEditorTool, type AudioSpectralSelection } from './spectralEditorModel'

/** 去爆音只修复极短的选区（与音频 Worker 的上限一致）。 */
const DECLICK_MAX_SECONDS = 0.128

export interface AudioWaveEditorState {
  tool: AudioEditorTool
  setTool: (tool: AudioEditorTool) => void
  display: AudioEditorDisplay
  setDisplay: (display: AudioEditorDisplay) => void
  brushPixels: number
  setBrushPixels: (pixels: number) => void
  view: WaveformViewport
  setView: (view: WaveformViewport) => void
  spectralSelection: AudioSpectralSelection | null
  setSpectralSelection: (selection: AudioSpectralSelection | null) => void
  /** 拖区间边缘时吸附到字声音真正的起止（默认关） */
  snapToSpeech: boolean
  setSnapToSpeech: (value: boolean) => void
}

const SNAP_TO_SPEECH_KEY = 'henji.audioEdit.snapToSpeech'
const readSnapToSpeech = (): boolean => { try { return localStorage.getItem(SNAP_TO_SPEECH_KEY) === '1' } catch { return false } }

export function useAudioWaveEditor(project: AudioEditProjectDocument | undefined): AudioWaveEditorState {
  const duration = project?.source.durationFrames ?? 0
  const [tool, setTool] = React.useState<AudioEditorTool>('time')
  const [display, setDisplay] = React.useState<AudioEditorDisplay>('both')
  const [brushPixels, setBrushPixels] = React.useState(12)
  const [view, setView] = React.useState<WaveformViewport>({ start: 0, end: duration })
  const [spectralSelection, setSpectralSelection] = React.useState<AudioSpectralSelection | null>(null)
  const [snapToSpeech, setSnapToSpeechState] = React.useState(readSnapToSpeech)
  const setSnapToSpeech = React.useCallback((value: boolean) => {
    setSnapToSpeechState(value)
    try { localStorage.setItem(SNAP_TO_SPEECH_KEY, value ? '1' : '0') } catch { /* 记不住时只影响下次打开的默认值 */ }
  }, [])
  const projectId = project?.id
  // 打开时回到上次停的缩放范围（播放头由试听引擎按同一份记录恢复）
  React.useEffect(() => {
    const remembered = projectId ? readAudioEditViewMemory(projectId, duration) : null
    setView(remembered ? { start: remembered.start, end: remembered.end } : { start: 0, end: duration || (project?.source.sampleRate ?? 48000) * 10 })
    setSpectralSelection(null)
  }, [projectId, duration, project?.source.sampleRate])
  // 缩放与播放头一变就记下（停稳后再写），下次打开从这里接着看
  const viewRef = React.useRef(view)
  viewRef.current = view
  const save = React.useRef<() => void>(() => undefined)
  React.useEffect(() => {
    if (!projectId) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = (): void => { timer = undefined; writeAudioEditViewMemory(projectId, { ...viewRef.current, playhead: useAudioEditPlaybackStore.getState().sourceFrame }) }
    save.current = () => { if (timer) clearTimeout(timer); timer = setTimeout(flush, 400) }
    const unsubscribe = useAudioEditPlaybackStore.subscribe((state, previous) => { if (state.sourceFrame !== previous.sourceFrame && !state.playing) save.current() })
    return () => { unsubscribe(); if (timer) { clearTimeout(timer); flush() } save.current = () => undefined }
  }, [projectId])
  React.useEffect(() => { save.current() }, [view])
  return { tool, setTool, display, setDisplay, brushPixels, setBrushPixels, view, setView, spectralSelection, setSpectralSelection, snapToSpeech, setSnapToSpeech }
}

/** 选区上的编辑动作：人和助手走同一组应用层函数（修复、区间音量都进同一撤销栈）。 */
export function audioWaveActions(project: AudioEditProjectDocument, run: (action: () => Promise<unknown>) => void) {
  const rate = project.source.sampleRate
  const addGain = (range: AudioEditRange, gainDb: number, fades: { in?: number; out?: number } = {}) => run(() => {
    const length = range.endFrame - range.startFrame
    const fadeIn = Math.min(length, Math.round(fades.in ?? 0)), fadeOut = Math.min(length - fadeIn, Math.round(fades.out ?? 0))
    const region: AudioEditGainRegion = { id: crypto.randomUUID(), startFrame: range.startFrame, endFrame: range.endFrame, gainDb, fadeInFrames: fadeIn, fadeOutFrames: fadeOut, enabled: true }
    return setAudioEditRegions(project.id, { gainRegions: [...project.gainRegions ?? [], region] })
  })
  const repair = (repairValue: Omit<AudioEditRepair, 'id' | 'enabled' | 'strength'>) => run(() => repairAudioEditRegion(project.id, { ...repairValue, id: crypto.randomUUID(), enabled: true, strength: 1 }))
  return {
    gain: (range: AudioEditRange, gainDb: number) => addGain(range, gainDb),
    fadeIn: (range: AudioEditRange) => addGain(range, 0, { in: range.endFrame - range.startFrame }),
    fadeOut: (range: AudioEditRange) => addGain(range, 0, { out: range.endFrame - range.startFrame }),
    canDeclick: (range: AudioEditRange) => (range.endFrame - range.startFrame) / rate <= DECLICK_MAX_SECONDS,
    declick: (range: AudioEditRange) => repair({ kind: 'declick', startFrame: range.startFrame, endFrame: range.endFrame, lowHz: 0, highHz: rate / 2 }),
    healArea: (area: AudioSpectralSelection) => repair({ kind: 'spectral_heal', startFrame: area.start, endFrame: area.end, lowHz: area.lowHz, highHz: Math.max(area.lowHz + 1, area.highHz) }),
    healStroke: (stroke: AudioBrushStroke) => {
      const bounds = strokeBounds(stroke, project.source.durationFrames, rate / 2)
      if (bounds.end <= bounds.start || bounds.highHz <= bounds.lowHz) return
      const width = bounds.end - bounds.start, height = bounds.highHz - bounds.lowHz
      const points = stroke.points.map(point => ({ x: (point.frame - bounds.start) / width, y: (point.hz - bounds.lowHz) / height }))
      // 屏幕上的圆形画笔：时间半径按帧、频率半径按笔画中心处的倍频程换算成该矩形里的比例。
      const center = stroke.points.reduce((total, point) => total + point.hz, 0) / stroke.points.length
      const radiusHz = center * (2 ** stroke.radiusOctaves - 1)
      repair({ kind: 'spectral_heal', startFrame: bounds.start, endFrame: bounds.end, lowHz: bounds.lowHz, highHz: bounds.highHz,
        strokes: [{ points, radius: Math.min(1, Math.max(1e-4, stroke.radiusFrames / width)), radiusY: Math.min(1, Math.max(1e-4, radiusHz / height)) }] })
    },
  }
}

const TOOL_KEYS: Record<string, AudioEditorTool> = { v: 'time', e: 'marquee', b: 'brush', h: 'hand' }
export function audioWaveToolForKey(key: string): AudioEditorTool | undefined { return TOOL_KEYS[key.toLowerCase()] }

