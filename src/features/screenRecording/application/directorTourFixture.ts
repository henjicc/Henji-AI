import { getPlatform } from '@/platform'
import { installRecordingNarrationFixture } from './recordingNarration'
import { registry } from '@/core/ModelRegistry'

/** Isolated tour assets replace only the paid TTS boundary; capture/edit/render/export stay real. */
export function installDirectorTourFixture(): void {
  if (!(import.meta.env.DEV || import.meta.env.MODE === 'development') || !window.henjiNative?.testFixtures) return
  const host = window as unknown as { __recordingDirectorTour?: { install(paths: Record<string, string>): void; calls: string[]; voice(): { modelId: string; options: DynamicValueMap } } }
  const calls: string[] = []
  host.__recordingDirectorTour = { calls, voice() {
    const model = registry.listAllModels().find(v => v.meta.type === 'audio' && v.params.some(param => 'panel' in param && param.panel === 'voice-selector'))
    if (!model) throw new Error('未加载正式语音模型目录。')
    return { modelId: model.meta.id, options: registry.getDefaultValues(model.meta.id) }
  }, install(paths) {
    installRecordingNarrationFixture(async (text, signal) => {
      signal.throwIfAborted()
      const path = paths[text]
      if (!path) throw new Error('模拟 TTS 未登记此句，拒绝调用真实供应商。')
      const source = await getPlatform().audioEdit.probeSource(path, crypto.randomUUID())
      signal.throwIfAborted(); calls.push(text)
      return { path, durationUs: Math.round(source.durationFrames / source.sampleRate * 1e6) }
    })
  } }
}
