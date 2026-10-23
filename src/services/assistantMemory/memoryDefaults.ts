import { currentDocumentContext, getDocumentSessionRegistry } from '@/features/documents'
import { memoryFontKey, resolveMemoryDefault } from '@/core/assistant/memoryDefaults'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { resolveMemoryValue, type MemoryEntry, type MemoryValue } from '@/core/assistant/memoryEntries'
import { createLogger } from '@/core/logging'
import { fontLibrarySnapshot, loadFontLibrary, resolveFont } from '@/platform/fonts'
import { setNewTextFontResolver } from '@/core/imaging/vectorContent/text'
import { cachedMemory, refreshMemory, subscribeMemory } from './memoryState'
const logger = createLogger('features.assistant.memoryDefaults')
const projects = new Map<string, MemoryEntry[]>()
let initialized = false
function projectForDocument(documentId?: string): string | undefined {
  const id = documentId ?? currentDocumentContext().documentId
  const session = id ? getDocumentSessionRegistry().get(id) : undefined
  const container = session?.documentMeta.container
  return container?.kind === 'project' ? container.projectId : undefined
}
export function rememberedDefault(key: MemoryValue['key'], documentId?: string, styleValue?: MemoryValue): ReturnType<typeof resolveMemoryValue> {
  const state = cachedMemory()
  const projectId = projectForDocument(documentId)
  return resolveMemoryDefault(key, state, projectId ? projects.get(projectId) ?? [] : [], styleValue)
}
/** 所有新文字入口共用字体选择；读取和渲染旧作品始终使用作品保存的字体。 */
export function rememberedFont(text = '文字', documentId?: string, styleFont?: string): string | undefined {
  const key = memoryFontKey(text)
  const result = rememberedDefault(key, documentId, styleFont ? { key, fonts: [styleFont] } : undefined)
  return result.value && 'fonts' in result.value ? result.value.fonts.find(name => Boolean(resolveFont(name))) : styleFont
}
async function refreshProjects(): Promise<void> {
  if (!cachedMemory()?.settings.enabled) { projects.clear(); return }
  const ids = new Set(getDocumentSessionRegistry().list().flatMap(session => session.documentMeta.container.kind === 'project' ? [session.documentMeta.container.projectId] : []))
  for (const id of projects.keys()) if (!ids.has(id)) projects.delete(id)
  await Promise.all([...ids].map(async id => { const entries = await getPlatform().assistant.readProjectMemory(id); if (cachedMemory()?.settings.enabled) projects.set(id, entries) }))
}
export function initializeMemoryDefaults(): void {
  if (initialized || !isDesktopRuntime()) return
  initialized = true
  const refresh = (): void => { void refreshProjects().catch(error => logger.error('项目记忆默认值读取失败', error, { event: 'memory.defaults.failed' })) }
  subscribeMemory(refresh)
  getDocumentSessionRegistry().subscribe(refresh)
  setNewTextFontResolver((text, documentId, styleFont) => fontLibrarySnapshot().error ? styleFont : rememberedFont(text, documentId, styleFont))
  void Promise.all([refreshMemory().then(refreshProjects), loadFontLibrary()]).catch(error => logger.error('记忆默认值初始化失败', error, { event: 'memory.defaults.failed' }))
}
