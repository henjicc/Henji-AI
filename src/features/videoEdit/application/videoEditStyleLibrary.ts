import { writeMemory } from '@/services/assistantMemory/memoryService'
import { registerStyleMemoryStorage } from '@/services/assistantMemory/styleMemoryStorage'
import { applyMemoryWrite } from '@/core/assistant/memoryOperations'
import { getPlatform } from '@/platform/runtime'
import { rememberedDefault } from '@/services/assistantMemory/memoryDefaults'
import { refreshMemory } from '@/services/assistantMemory/memoryState'
import { createLogger } from '@/core/logging'
import { PERSISTENCE_FORMATS } from '@/core/persistence/formats'
import { parseVersionedPersistenceJson, readLocalPersistenceJson, localLibraryContract } from '@/core/persistence/versionedJson'
import { persistenceMinReaderVersion } from '@/core/persistence/migrations'
import { assertApplicationWritesAllowed } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { videoEditStyleContentHash, videoEditStyleSchema, videoEditTemplateContentHash, type VideoEditStyle } from '@/core/videoEdit/styles/styleSchemas'
import { videoEditTemplateSchema, type VideoEditTemplate } from '@/core/videoEdit/styles/templateSchemas'
import { migrateStyleKit, migrateTitleTemplate, styleKitMigrationSchema, titleTemplateMigrationSchema } from '@/core/videoEdit/styles/styleTemplateMigration'
import { z } from 'zod'
import { appLocalDataDir, exists, getBundledResourcePath, join, mkdir, readDir, readFile, readTextFile, remove, writeFile, writeTextFile } from '@/platform/desktopApi'
import { publishVideoEdit } from './videoEditService'

const logger = createLogger('features.videoEdit.styleLibrary')
const STYLE_FORMAT = PERSISTENCE_FORMATS.find(format => format.id === 'video-style-library')!
const TEMPLATE_FORMAT = PERSISTENCE_FORMATS.find(format => format.id === 'video-template-library')!
/** 内置风格按“克制 → 热闹 → 纪实”排列（与 Frameflow 档位表同序）。 */
export const BUILTIN_STYLE_IDS = ['restrained', 'tech-info', 'explainer', 'variety', 'promo', 'warm-documentary'] as const
const MIGRATION_STORAGE_KEYS = { styles: 'video-edit-style-kits', templates: 'video-edit-title-templates' } as const

/** 样片派生的媒体文件（本机绝对路径）；没有渲染过时为空。 */
export interface VideoEditStyleMedia { preview?: string; thumbnail?: string; anchors: string[] }
export interface VideoEditLibraryStyle {
  style: VideoEditStyle; builtin: boolean; dir: string; media: VideoEditStyleMedia
  /** 说明书或样片改过、还没重新渲染（预览与版本号仍是上一次渲染的）。 */
  stale: boolean
}
export interface VideoEditLibraryTemplate { template: VideoEditTemplate; file: string }
export interface VideoEditStyleMediaBytes { preview?: Uint8Array; thumbnail?: Uint8Array; anchors: Uint8Array[] }

/** 文件访问边界：正式环境走桌面 PAL，测试注入隔离目录。 */
export interface VideoEditStyleLibraryIo {
  root(): Promise<string>
  builtinRoot(): Promise<string | null>
  join(...parts: string[]): Promise<string>
  exists(path: string): Promise<boolean>
  readText(path: string): Promise<string>
  writeText(path: string, text: string): Promise<void>
  readBytes(path: string): Promise<Uint8Array>
  writeBytes(path: string, bytes: Uint8Array): Promise<void>
  list(path: string): Promise<Array<{ name: string; isDirectory: boolean }>>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}
export const desktopStyleLibraryIo: VideoEditStyleLibraryIo = {
  root: async () => join(await appLocalDataDir(), 'video-edit-styles'),
  builtinRoot: async () => { const index = await getBundledResourcePath('video-edit-styles/index.json'); return index ? index.replace(/[\\/]index\.json$/, '') : null },
  join, exists, readText: readTextFile, writeText: writeTextFile, readBytes: readFile, writeBytes: writeFile,
  list: path => readDir(path), mkdir: path => mkdir(path, { recursive: true }), remove: path => remove(path, { recursive: true }),
}

function container(format: typeof STYLE_FORMAT, content: unknown): string { return `${JSON.stringify({ version: format.version, minReaderVersion: persistenceMinReaderVersion(format), content: format.schema.parse(content) }, null, 2)}\n` }
function decode<T>(format: typeof STYLE_FORMAT, text: string, path: string): T {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error(`风格库文件损坏，无法解析：${path}`) }
  return format.schema.parse(parseVersionedPersistenceJson(raw, format)) as T
}
const padded = (index: number): string => String(index + 1).padStart(2, '0')

/**
 * 风格库（全局）：用户的风格与模板跨工程复用，内置六套风格随安装包提供、只读。
 * 目录：<应用数据>/video-edit-styles/styles/<ID>/{style.json, preview.mp4, thumbnail.jpg, anchors/NN.jpg}，
 * templates/<ID>.json。读写全部经这里串行，写完通知界面与助手目录刷新。
 */
export class VideoEditStyleLibrary {
  private styles = new Map<string, VideoEditLibraryStyle>()
  private templates = new Map<string, VideoEditLibraryTemplate>()
  private loading?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private error = ''
  constructor(private io: VideoEditStyleLibraryIo = desktopStyleLibraryIo, private migrationStorage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined' ? undefined : localStorage, private readonly publish: () => void = () => publishVideoEdit(true)) {}
  /** 换一个资料目录重新读取（隔离测试与切换资料目录时用）。 */
  reset(io: VideoEditStyleLibraryIo = desktopStyleLibraryIo, migrationStorage?: Pick<Storage, 'getItem' | 'setItem'>): void {
    this.io = io; this.migrationStorage = migrationStorage; this.loading = undefined; this.error = ''; this.styles = new Map(); this.templates = new Map(); this.queue = Promise.resolve()
  }

  ready(): Promise<void> { this.loading ??= this.load().then(() => { this.error = '' }, error => { this.loading = undefined; this.error = `风格库读取失败，原文件已保留：${error instanceof Error ? error.message : String(error)}`; throw error }); return this.loading }
  loaded(): boolean { return Boolean(this.loading) && !this.error }
  loadError(): string { return this.error }
  /** 个人风格在前（最近修改优先），内置风格按固定顺序在后。 */
  listStyles(): VideoEditLibraryStyle[] {
    const values = [...this.styles.values()]
    const rank = (entry: VideoEditLibraryStyle): number => entry.builtin ? BUILTIN_STYLE_IDS.indexOf(entry.style.id as typeof BUILTIN_STYLE_IDS[number]) : -1
    return structuredClone(values.sort((a, b) => Number(a.builtin) - Number(b.builtin) || rank(a) - rank(b) || b.style.updatedAt.localeCompare(a.style.updatedAt)))
  }
  findStyle(id: string): VideoEditLibraryStyle | undefined { const value = this.styles.get(id); return value && structuredClone(value) }
  requireStyle(id: string): VideoEditLibraryStyle { const value = this.findStyle(id); if (!value) throw new Error(`NOT_FOUND：风格库里没有这个风格（${id}），请重新列出 video_edit.style。`); return value }
  listTemplates(styleId?: string): VideoEditLibraryTemplate[] { return structuredClone([...this.templates.values()].filter(entry => styleId === undefined || entry.template.style?.id === styleId).sort((a, b) => a.template.name.localeCompare(b.template.name, 'zh-Hans-CN'))) }
  findTemplate(id: string): VideoEditLibraryTemplate | undefined { const value = this.templates.get(id); return value && structuredClone(value) }
  requireTemplate(id: string): VideoEditLibraryTemplate { const value = this.findTemplate(id); if (!value) throw new Error(`NOT_FOUND：风格库里没有这个模板（${id}），请重新列出 video_edit.template。`); return value }
  defaultStyleId(documentId?: string): string | null { const value = rememberedDefault('style', documentId).value; const id = value?.key === 'style' ? value.id : null; return id && this.styles.has(id) ? id : null }

  /** 写入或替换一个个人风格（不改版本号：版本只在渲染时随内容变化加 1）；media 给出时整组替换预览文件。 */
  saveStyle(style: VideoEditStyle, media?: VideoEditStyleMediaBytes, preferencesOnly = false): Promise<VideoEditLibraryStyle> {
    return this.write('style.save', async () => {
      const previous = this.styles.get(style.id)
      if (previous?.builtin && !preferencesOnly) throw new Error('内置风格只读；要修改请先复制成个人风格。')
      const value = videoEditStyleSchema.parse({ ...(preferencesOnly && previous ? { ...previous.style, userPreferences: style.userPreferences, version: style.version } : style), updatedAt: new Date().toISOString() })
      const dir = await this.io.join(await this.io.root(), 'styles', value.id); await this.io.mkdir(dir)
      let current = this.styles.get(value.id)?.media ?? { anchors: [] }
      if (media) {
        await this.io.remove(await this.io.join(dir, 'anchors')).catch(() => undefined)
        current = { anchors: [] }
        if (media.preview) { current.preview = await this.io.join(dir, 'preview.mp4'); await this.io.writeBytes(current.preview, media.preview) }
        if (media.thumbnail) { current.thumbnail = await this.io.join(dir, 'thumbnail.jpg'); await this.io.writeBytes(current.thumbnail, media.thumbnail) }
        if (media.anchors.length) await this.io.mkdir(await this.io.join(dir, 'anchors'))
        for (const [index, bytes] of media.anchors.entries()) { const file = await this.io.join(dir, 'anchors', `${padded(index)}.jpg`); await this.io.writeBytes(file, bytes); current.anchors.push(file) }
      }
      if (preferencesOnly && previous && !previous.stale) value.contentHash = await videoEditStyleContentHash(value)
      await this.io.writeText(await this.io.join(dir, 'style.json'), container(STYLE_FORMAT, value))
      const entry = { style: value, builtin: previous?.builtin ?? false, dir, media: current, stale: value.contentHash !== await videoEditStyleContentHash(value) }
      this.styles.set(value.id, entry); return structuredClone(entry)
    })
  }
  removeStyle(id: string): Promise<void> {
    return this.write('style.remove', async () => {
      const entry = this.styles.get(id)
      if (!entry || entry.builtin) throw new Error('只能删除风格库里的个人风格，内置风格只读。')
      await this.io.remove(entry.dir); this.styles.delete(id)
      if (rememberedDefault('style').value?.key === 'style' && (rememberedDefault('style').value as { id: string }).id === id) await this.setDefaultStyle(null)
      // 模板可以单独存在：风格删掉后成员模板保留，只去掉所属关系。
      for (const template of [...this.templates.values()].filter(value => value.template.style?.id === id)) await this.putTemplate({ ...template.template, style: null })
    })
  }
  async setDefaultStyle(id: string | null, actor: 'user' | 'assistant' = 'user'): Promise<void> {
    if (id) this.requireStyle(id)
    const state = await refreshMemory()
    const entries = state.entries.filter(entry => entry.value?.key === 'style').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    if (id) await writeMemory({ target: { layer: 'global' }, id: entries[0]?.id ?? crypto.randomUUID(), expectedRevision: entries[0]?.revision ?? 0, actor, reason: '在风格库设为默认。', entry: { section: 'creative', content: `新序列默认使用${this.requireStyle(id).style.name}。`, source: actor, value: { key: 'style', id } } })
    else for (const entry of entries) await writeMemory({ target: { layer: 'global' }, id: entry.id, expectedRevision: entry.revision, actor, reason: '取消默认风格。', entry: null })
    this.publish()
  }

  /** 写入模板：内容摘要变了版本加 1，只改名称、说明或所属风格不升版本。 */
  saveTemplate(template: VideoEditTemplate): Promise<VideoEditLibraryTemplate> { return this.write('template.save', () => this.putTemplate(template)) }
  removeTemplate(id: string): Promise<void> {
    return this.write('template.remove', async () => { const entry = this.templates.get(id); if (!entry) throw new Error('风格库里没有这个模板。'); await this.io.remove(entry.file); this.templates.delete(id) })
  }
  /** 媒体文件的字节（导出分享文件时用）。 */
  async readStyleMedia(id: string): Promise<VideoEditStyleMediaBytes> {
    const entry = this.requireStyle(id)
    return { ...(entry.media.preview ? { preview: await this.io.readBytes(entry.media.preview) } : {}), ...(entry.media.thumbnail ? { thumbnail: await this.io.readBytes(entry.media.thumbnail) } : {}), anchors: await Promise.all(entry.media.anchors.map(path => this.io.readBytes(path))) }
  }

  private async putTemplate(template: VideoEditTemplate): Promise<VideoEditLibraryTemplate> {
    const previous = this.templates.get(template.id)?.template
    const hash = await videoEditTemplateContentHash(template.body)
    const changed = !previous || previous.contentHash !== hash
    const value = videoEditTemplateSchema.parse({ ...template, contentHash: hash, version: previous ? previous.version + (changed && previous.contentHash ? 1 : 0) : Math.max(1, template.version), updatedAt: new Date().toISOString() })
    const dir = await this.io.join(await this.io.root(), 'templates'); await this.io.mkdir(dir)
    const file = await this.io.join(dir, `${value.id}.json`)
    await this.io.writeText(file, container(TEMPLATE_FORMAT, value))
    const entry = { template: value, file }; this.templates.set(value.id, entry); return structuredClone(entry)
  }
  private write<T>(event: string, action: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      assertApplicationWritesAllowed(); await this.ready()
      if (this.error) throw new Error(this.error)
      logger.info(`${event}.start`, '写入风格库')
      try { const result = await action(); logger.info(`${event}.completed`, '风格库已写入'); this.publish(); return result }
      catch (error) { logger.error(`${event}.failed`, '风格库写入失败', { error }); throw error }
    }
    const next = this.queue.then(run, run); this.queue = next.catch(() => undefined); return next
  }
  private async load(): Promise<void> {
    logger.info('load.start', '读取风格库')
    const styles = new Map<string, VideoEditLibraryStyle>(); const templates = new Map<string, VideoEditLibraryTemplate>()
    const readStyleDir = async (dir: string, builtin: boolean): Promise<void> => {
      const style = decode<VideoEditStyle>(STYLE_FORMAT, await this.io.readText(await this.io.join(dir, 'style.json')), dir)
      const media: VideoEditStyleMedia = { anchors: [] }
      for (const [key, file] of [['preview', 'preview.mp4'], ['thumbnail', 'thumbnail.jpg']] as const) { const path = await this.io.join(dir, file); if (await this.io.exists(path)) media[key] = path }
      const anchors = await this.io.join(dir, 'anchors')
      if (await this.io.exists(anchors)) for (const entry of (await this.io.list(anchors)).filter(value => !value.isDirectory && /^\d+\.jpg$/.test(value.name)).sort((a, b) => a.name.localeCompare(b.name))) media.anchors.push(await this.io.join(anchors, entry.name))
      styles.set(style.id, { style, builtin, dir, media, stale: style.contentHash !== await videoEditStyleContentHash(style) })
    }
    const builtinRoot = await this.io.builtinRoot()
    if (builtinRoot) for (const id of BUILTIN_STYLE_IDS) {
      try { await readStyleDir(await this.io.join(builtinRoot, id), true) }
      catch (error) { logger.error('load.builtin_failed', '内置风格读取失败', { error, context: { id } }) }
    }
    const root = await this.io.root(); const problems: string[] = []
    const stylesDir = await this.io.join(root, 'styles')
    if (await this.io.exists(stylesDir)) for (const entry of await this.io.list(stylesDir)) {
      if (!entry.isDirectory || entry.name.startsWith('.')) continue
      const builtin = styles.get(entry.name)
      if (builtin?.builtin) {
        try {
          const local = decode<VideoEditStyle>(STYLE_FORMAT, await this.io.readText(await this.io.join(stylesDir, entry.name, 'style.json')), entry.name)
          const style = videoEditStyleSchema.parse({ ...builtin.style, userPreferences: local.userPreferences, version: Math.max(builtin.style.version, local.version), updatedAt: local.updatedAt })
          style.contentHash = await videoEditStyleContentHash(style)
          styles.set(entry.name, { ...builtin, style })
        } catch (error) { problems.push(entry.name); logger.error('load.preferences_failed', '风格使用者偏好读取失败，原文件已保留', { error }) }
        continue
      }
      try { await readStyleDir(await this.io.join(stylesDir, entry.name), false) } catch (error) { problems.push(entry.name); logger.error('load.style_failed', '个人风格读取失败，原文件已保留', { error, context: { id: entry.name } }) }
    }
    const templatesDir = await this.io.join(root, 'templates')
    if (await this.io.exists(templatesDir)) for (const entry of await this.io.list(templatesDir)) {
      if (entry.isDirectory || !entry.name.endsWith('.json')) continue
      const file = await this.io.join(templatesDir, entry.name)
      try { const template = decode<VideoEditTemplate>(TEMPLATE_FORMAT, await this.io.readText(file), file); templates.set(template.id, { template, file }) } catch (error) { problems.push(entry.name); logger.error('load.template_failed', '模板读取失败，原文件已保留', { error, context: { file: entry.name } }) }
    }
    this.styles = styles; this.templates = templates
    if (problems.length) logger.warn('load.partial', '部分风格或模板无法读取', { context: { count: problems.length } })
    try { await this.importStoredStyleKits(root) } catch (error) { logger.error('legacy.import_failed', '旧本机风格与标题模板转存失败，下次启动重试', { error }) }
    logger.info('load.completed', '风格库已读取', { context: { styles: styles.size, templates: templates.size } })
    this.publish()
  }
  /** 旧本机风格库与标题模板（localStorage）只读：第一次加载时转存成文件，原键保持不变，再次加载不重复转存。 */
  private async importStoredStyleKits(root: string): Promise<void> {
    if (!this.migrationStorage) return
    const marker = await this.io.join(root, 'legacy-import.json')
    if (await this.io.exists(marker)) return
    const read = <T>(key: string, schema: z.ZodType<T[]>): T[] => { const text = this.migrationStorage!.getItem(key); if (!text) return []; try { return schema.parse(readLocalPersistenceJson(text, key, localLibraryContract(key, schema), this.migrationStorage!)) } catch (error) { logger.error('legacy.read_failed', '旧本机库读取失败，原数据已保留', { error, context: { key } }); throw error } }
    const kits = read(MIGRATION_STORAGE_KEYS.styles, z.array(styleKitMigrationSchema)); const titles = read(MIGRATION_STORAGE_KEYS.templates, z.array(titleTemplateMigrationSchema))
    const now = new Date().toISOString(); const imported = { styles: [] as string[], templates: [] as string[] }
    await this.io.mkdir(root)
    for (const kit of kits) {
      const style = migrateStyleKit(kit, now)
      if (this.styles.has(style.id)) continue
      const dir = await this.io.join(root, 'styles', style.id); await this.io.mkdir(dir)
      await this.io.writeText(await this.io.join(dir, 'style.json'), container(STYLE_FORMAT, style))
      this.styles.set(style.id, { style, builtin: false, dir, media: { anchors: [] }, stale: true }); imported.styles.push(style.id)
    }
    for (const title of titles) {
      const template = migrateTitleTemplate(title, now)
      if (this.templates.has(template.id)) continue
      await this.putTemplate(template); imported.templates.push(template.id)
    }
    await this.io.writeText(marker, `${JSON.stringify({ importedAt: now, ...imported }, null, 2)}\n`)
    if (imported.styles.length || imported.templates.length) logger.info('legacy.imported', '旧本机风格与标题模板已转存到风格库', { context: { styles: imported.styles.length, templates: imported.templates.length } })
  }
}
export const videoEditStyleLibrary = new VideoEditStyleLibrary()

// 由风格领域提供存储，记忆服务只依赖此端口；全局默认风格仍走同一记忆写入队列。
registerStyleMemoryStorage({
  async list() { await videoEditStyleLibrary.ready(); return videoEditStyleLibrary.listStyles().map(entry => entry.style.id) },
  async read(id) { await videoEditStyleLibrary.ready(); return videoEditStyleLibrary.requireStyle(id).style.userPreferences ?? [] },
  async write(input) {
    await videoEditStyleLibrary.ready()
    const previous = videoEditStyleLibrary.requireStyle(input.target.ownerId).style
    const result = applyMemoryWrite(previous.userPreferences ?? [], input, new Date(), crypto.randomUUID())
    if (result.change) {
      await videoEditStyleLibrary.saveStyle({ ...previous, userPreferences: result.entries, version: previous.version + 1 }, undefined, true)
      try { await getPlatform().assistant.recordMemoryChange(result.change) }
      catch (error) { await videoEditStyleLibrary.saveStyle(previous, undefined, true); throw error }
    }
    return result.change
  },
})
