import path from 'node:path'
import { audioEditRealtimeEffects } from '../../../../src/core/audioEdit/effects'
import type { AudioEffectInstance } from '../../../../src/core/audio/effects/audioEffectChain'
import type { AudioEditProjectDocument } from '../../../../src/core/audioEdit/types'
import { audioEditCacheDirectory } from './media'
import { audioRenderKey, cachedAudioFile } from './render-cache'
import { runAudioEditEffectsWorker } from './effects-worker-client'
import { AUDIO_IDENTITY_PHASES, audioEffectsIdentity } from '../../../../src/core/audio/effects/audioIdentity'

/**
 * 导出、动态链接用的声音过一遍边播边算的那段效果（效果链末尾的实时效果 + 输出）：与试听同一份实现，在主进程工作线程里离线处理，
 * 按“输入文件 + 效果”缓存（输入本身已按内容命名），没改过效果就直接复用。没有效果时原样返回输入。
 */
export async function applyAudioEditRealtimeEffects(project: AudioEditProjectDocument, input: string, signal?: AbortSignal, onProgress?: (value: number) => void): Promise<string> {
  return applyAudioEffectInstancesToFile(project.id, input, audioEditRealtimeEffects(project), signal, onProgress)
}

/** 把一串实时效果离线跑过一个 32 位浮点 WAV（效果链里排在整段处理效果之前的实时效果也用它）。 */
export async function applyAudioEffectInstancesToFile(projectId: string, input: string, effects: readonly AudioEffectInstance[], signal?: AbortSignal, onProgress?: (value: number) => void): Promise<string> {
  if (!effects.length) return input
  const keys = AUDIO_IDENTITY_PHASES.map(phase => `fx-${audioRenderKey(['effects-v1', path.basename(input), audioEffectsIdentity(effects, phase)])}`)
  return cachedAudioFile(audioEditCacheDirectory(projectId), keys[0], 'wav', output => runAudioEditEffectsWorker({ kind: 'effects', input, output, effects: [...effects] }, signal, onProgress), signal, keys.slice(1))
}
