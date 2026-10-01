import { useEffect, useState } from 'react'
import { getPlatform } from '@/platform/runtime'
import type { AudioWaveformRangeRequest, AudioWaveformRangeResult } from '@/platform/contracts/audioWaveform'

export interface VideoEditWaveformRequest { key: string; request: AudioWaveformRangeRequest }
export interface VideoEditWaveformState { result?: AudioWaveformRangeResult; error?: string }
const EMPTY: ReadonlyMap<string, VideoEditWaveformState> = new Map()
/** Only visible ranges are submitted. Two delivery slots share the native bounded service. */
export function useVideoEditWaveformRanges(requests: readonly VideoEditWaveformRequest[], visible: boolean): ReadonlyMap<string, VideoEditWaveformState> {
  const scope = JSON.stringify(visible ? requests : [])
  const [state, setState] = useState<{ scope: string; results: ReadonlyMap<string, VideoEditWaveformState> }>({ scope: '', results: EMPTY })
  useEffect(() => {
    const controller = new AbortController()
    const inputs = JSON.parse(scope) as VideoEditWaveformRequest[]
    const results = new Map<string, VideoEditWaveformState>(); setState({ scope, results })
    let index = 0
    const consume = async (): Promise<void> => {
      while (!controller.signal.aborted && index < inputs.length) {
        const input = inputs[index++]
        try {
          const result = await getPlatform().audioEdit.extractWaveformRange(input.request, controller.signal)
          if (controller.signal.aborted) return
          results.set(input.key, { result })
        } catch (error) {
          if (controller.signal.aborted) return
          results.set(input.key, { error: error instanceof Error ? error.message : '波形未能读取，请重新导入原素材。' })
        }
        setState({ scope, results: new Map(results) })
      }
    }
    void consume(); void consume()
    return () => controller.abort(new DOMException('波形视图已改变。', 'AbortError'))
  }, [scope])
  return state.scope === scope ? state.results : EMPTY
}
