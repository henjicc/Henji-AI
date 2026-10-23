import { useSettingsStore } from '@/stores/settingsStore'
import { rememberedDefault } from '@/features/assistant/memory/memoryDefaults'
/** 新建序列的唯一默认入口：明确输入仍由调用方最后覆盖。 */
export function getVideoEditSequenceDefaults(documentId?: string) {
  const defaults = useSettingsStore.getState().videoEditSequenceDefaults
  const value = rememberedDefault('aspect', documentId).value
  if (value?.key !== 'aspect') return defaults
  const ratio = value.width / value.height
  const width = ratio >= 1 ? defaults.width : Math.round(defaults.height * ratio / 2) * 2
  const height = ratio >= 1 ? Math.round(defaults.width / ratio / 2) * 2 : defaults.height
  return { ...defaults, width: Math.max(2, width), height: Math.max(2, height) }
}
