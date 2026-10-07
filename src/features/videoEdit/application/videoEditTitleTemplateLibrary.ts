import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { z } from 'zod'
import { createLogger } from '@/core/logging'
import { BUILTIN_TITLE_TEMPLATES, titleTemplateSchema, type TitleTemplate } from '@/core/videoEdit/titleTemplates'
import { publishVideoEdit } from './videoEditService'
import { VideoEditLocalLibrary } from './videoEditLocalLibrary'

const logger = createLogger('features.videoEdit.titleTemplates')
export const TITLE_TEMPLATE_STORAGE_KEY = 'video-edit-title-templates'
const librarySchema = z.array(titleTemplateSchema).superRefine((items, context) => { if (new Set(items.map(item => item.id)).size !== items.length || items.some(item => item.id.startsWith('title:'))) context.addIssue({ code: 'custom', message: '自定义模板标识重复或与内置模板冲突。' }) })
interface LibraryState { templates: TitleTemplate[]; error: string; replace(templates: readonly TitleTemplate[]): void }
export function createTitleTemplateLibrary(storage?: Pick<Storage, 'getItem' | 'setItem'>): UseBoundStore<StoreApi<LibraryState>> {
  const library = new VideoEditLocalLibrary(TITLE_TEMPLATE_STORAGE_KEY, librarySchema, storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage), () => {})
  const templates = library.custom(); const error = library.loadError()
  return create<LibraryState>(set => ({ templates, error, replace(values) {
    logger.info('title_library.save.start', '保存本机标题模板')
    try { library.replace(values); set({ templates: library.custom() }); publishVideoEdit(true); logger.info('title_library.save.completed', '标题模板已保存') }
    catch (reason) { logger.error('title_library.save.failed', '标题模板未能保存', { error: reason }); throw reason }
  } }))
}
export const useTitleTemplateLibrary = createTitleTemplateLibrary()
export function listTitleTemplates(): TitleTemplate[] { return structuredClone([...BUILTIN_TITLE_TEMPLATES, ...useTitleTemplateLibrary.getState().templates]) }
export function requireTitleTemplate(id: string): TitleTemplate { const template = listTitleTemplates().find(template => template.id === id); if (!template) throw new Error('NOT_FOUND：原标题模板已删除，请重新列出模板。'); return template }
