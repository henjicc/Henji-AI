import type { ApplicationStoreActionLedger } from '@/core/application-control'

import type { useAudioEditPlaybackStore } from '../store/audioEditPlaybackStore'

type State = ReturnType<typeof useAudioEditPlaybackStore.getState>
type ActionName = {
  [K in keyof State]-?: State[K] extends (...args: never[]) => unknown ? K : never
}[keyof State]

const PLAYBACK_REASON = '播放、暂停与原始或成片试听只控制当前界面的扬声器和播放头，不改变工程或导出结果。'
const ENGINE_REASON = '预览准备状态与错误由 AudioWorklet 缓冲和预览引擎回填，不是可直接写入的用户数据。'

export const AUDIO_EDIT_PLAYBACK_STORE_LEDGER: ApplicationStoreActionLedger<ActionName> = {
  storeId: 'audioEditPlaybackStore',
  title: '口播剪辑试听状态',
  entries: {
    setAutoGain: { kind: 'excluded', category: 'view_state', reason: '试听自动增益仅调节本机扬声器音量，不改变工程、媒体或导出；由用户在播放栏控制。' },
    setVolume: { kind: 'excluded', category: 'view_state', reason: '本机试听音量由用户控制，不改变工程、媒体或导出。' },
    setMode: { kind: 'excluded', category: 'view_state', reason: PLAYBACK_REASON },
    setPlaying: { kind: 'excluded', category: 'view_state', reason: PLAYBACK_REASON },
    setPreparing: { kind: 'excluded', category: 'derived', reason: ENGINE_REASON },
    setReady: { kind: 'excluded', category: 'derived', reason: ENGINE_REASON },
    setError: { kind: 'excluded', category: 'derived', reason: ENGINE_REASON },
    updatePosition: {
      kind: 'excluded', category: 'derived',
      reason: '源帧、成片帧和文字高亮由实际播放进度计算并回填，不能作为工程数据直接改写。',
    },
  },
}
