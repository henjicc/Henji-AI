/** A completed voice is useful even when the supplier omits its optional preview. */
export function clonedVoiceCompletion(metadata: DynamicValue): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const voice = metadata.clonedVoice
  if (!voice || typeof voice !== 'object' || Array.isArray(voice)
    || voice.status !== 'ready' || typeof voice.id !== 'string' || !voice.id.trim()
    || typeof voice.name !== 'string' || !voice.name.trim()) return undefined
  return `“${voice.name}”已保存到音色库，可切换到语音合成后选择使用。`
}
