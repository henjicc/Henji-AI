import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  acquireWaveform, acquireWaveformDetail, planWaveformDetailWindow, readWaveformDetail, readWaveformState, subscribeWaveformData, waveformDataRevision, waveformDetailKey, waveformKey,
  type WaveformData, type WaveformDetailWindow, type WaveformScope, type WaveformSourceRef, type WaveformState,
} from '@/services/waveform/waveformDataService'

export type { WaveformData, WaveformDetailWindow, WaveformScope, WaveformSourceRef, WaveformState }

function useWaveformRevision(): number {
  return useSyncExternalStore(subscribeWaveformData, waveformDataRevision, waveformDataRevision)
}

/** 多个来源（如声道映射片段的每条声道）各自的波形状态；顺序与输入一致。 */
export function useWaveformDataList(refs: readonly WaveformSourceRef[], scope: WaveformScope = 'overview', enabled = true): WaveformState[] {
  const revision = useWaveformRevision()
  const scopeKey = JSON.stringify(enabled ? refs.map((ref) => waveformKey(ref, scope)) : [])
  const stable = useRef<{ key: string; refs: readonly WaveformSourceRef[] }>({ key: '', refs: [] })
  if (stable.current.key !== scopeKey) stable.current = { key: scopeKey, refs: enabled ? refs : [] }
  const current = stable.current.refs
  useEffect(() => {
    const releases = current.map((ref) => acquireWaveform(ref, scope))
    return () => releases.forEach((release) => release())
  }, [current, scope])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the store snapshot that invalidates the read
  return useMemo(() => current.map((ref) => readWaveformState(ref, scope)), [current, scope, revision])
}

/** 一个来源的波形状态；ref 为空时为 idle。 */
export function useWaveformData(ref: WaveformSourceRef | null | undefined, scope: WaveformScope = 'overview', enabled = true): WaveformState {
  const refs = useMemo(() => (ref ? [ref] : []), [ref])
  const [state] = useWaveformDataList(refs, scope, enabled && !!ref)
  return state ?? { status: 'idle' }
}

/**
 * 精细档：视图比第 0 级更细时回读视图附近的原始采样。窗口仍覆盖视图时沿用，避免平移就重新请求。
 */
export function useWaveformDetail(data: WaveformData | undefined, startFrame: number, endFrame: number, enabled: boolean): WaveformDetailWindow | undefined {
  const revision = useWaveformRevision()
  const held = useRef<{ dataKey: string; start: number; end: number } | null>(null)
  let plan: { start: number; end: number } | undefined
  if (enabled && data) {
    const previous = held.current
    plan = previous && previous.dataKey === `${data.key}|${data.pyramid.version}` && previous.start <= startFrame && previous.end >= endFrame
      ? previous
      : planWaveformDetailWindow(data.pyramid.frameCount, startFrame, endFrame)
  }
  const key = plan && data ? waveformDetailKey(data, plan.start, plan.end) : ''
  useEffect(() => {
    if (!plan || !data) return
    held.current = { dataKey: `${data.key}|${data.pyramid.version}`, start: plan.start, end: plan.end }
    return acquireWaveformDetail(data, plan.start, plan.end)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the detail key captures data and plan
  }, [key])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- revision is the store snapshot that invalidates the read
  return useMemo(() => (key ? readWaveformDetail(key) : undefined), [key, revision])
}
