import { resolveMemoryValue, type MemoryEntry, type MemorySnapshot, type MemoryValue } from './memoryEntries'

/** 开关和层级优先级的纯计算；文档定位、缓存和字体目录由宿主提供。 */
export function resolveMemoryDefault(key: MemoryValue['key'], state: MemorySnapshot | undefined, project: readonly MemoryEntry[], styleValue?: MemoryValue): ReturnType<typeof resolveMemoryValue> {
  if (!state?.settings.enabled) return { value: styleValue, askUser: false }
  return resolveMemoryValue(key, state.entries, project, styleValue)
}

export function memoryFontKey(text: string): 'font.numeric' | 'font.zh' | 'font.latin' {
  return /^\s*[\d\s.,:%+−-]+$/.test(text) ? 'font.numeric' : /[\u3400-\u9fff]/.test(text) || !text ? 'font.zh' : 'font.latin'
}
