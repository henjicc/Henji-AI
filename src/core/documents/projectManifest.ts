import { foreignContentSchema, type ContentTrustReference } from '../contentTrust'
import { formatMigrations } from '../persistence/formatMigrations'
import { z } from 'zod'
import { projectMemoryEntriesSchema, type MemoryEntry } from '../assistant/memoryEntries'

import { documentIdSchema } from './envelope'
import type { FolderLocale } from './types'
import { migratePersistenceContent, persistenceForwardFields, upgradePersistenceContent, type PersistenceContract } from '../persistence/migrations'
import { restoreForwardFields } from '../persistence/forwardCompat'

/*
 * 项目说明 `<项目>/.henji/project.json`（实施方案 2.3）。
 *
 * 项目名就是文件夹名，不写进说明；说明只记稳定 ID、创建时间、文件夹语言与项目内两个固定子文件夹名
 * （按项目创建时的语言确定，拷给另一种界面语言的用户也能打开）、草稿标记与主剪辑。
 */

export const PROJECT_MANIFEST_FORMAT = 'henji-project' as const
export const PROJECT_MANIFEST_VERSION = 3 as const
/** 项目与作品目录里的内部文件夹（项目说明与内部资源），Windows 上设为隐藏。 */
export const INTERNAL_FOLDER_NAME = '.henji'
export const PROJECT_MANIFEST_FILE_NAME = 'project.json'

export const PROJECT_FOLDER_NAMES: Readonly<Record<FolderLocale, { generated: string; materials: string }>> = {
  zh: { generated: '生成结果', materials: '素材' },
  en: { generated: 'Generated', materials: 'Media' },
}

export const UNTITLED_PROJECT_NAMES: Readonly<Record<FolderLocale, string>> = {
  zh: '未命名项目',
  en: 'Untitled Project',
}

export interface ProjectManifest {
  format: typeof PROJECT_MANIFEST_FORMAT
  version: typeof PROJECT_MANIFEST_VERSION
  /** 能读懂这份说明的最低程序版本；只新增可选字段时不变。 */
  minReaderVersion: number
  id: string
  createdAt: string
  locale: FolderLocale
  folders: { generated: string; materials: string }
  draft?: true
  mainVideoEditId?: string
  memories?: MemoryEntry[]
  foreign?: ContentTrustReference
}

const folderNameSchema = z.string().min(1).max(120).refine(
  (value) => !/[<>:"/\\|?*]/.test(value) && value !== '.' && value !== '..' && value !== INTERNAL_FOLDER_NAME,
  '项目子文件夹名无效。',
)

export const projectManifestSchema = z.object({
  format: z.literal(PROJECT_MANIFEST_FORMAT),
  version: z.literal(PROJECT_MANIFEST_VERSION),
  minReaderVersion: z.number().int().positive().optional(),
  id: documentIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
  locale: z.enum(['zh', 'en']),
  folders: z.object({ generated: folderNameSchema, materials: folderNameSchema }).strict(),
  draft: z.boolean().optional(),
  mainVideoEditId: documentIdSchema.optional(),
  memories: projectMemoryEntriesSchema.optional(),
  foreign: foreignContentSchema.optional(),
}).strict()

export class ProjectManifestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProjectManifestError'
  }
}

export interface ProjectManifestFields {
  id: string
  createdAt: string
  locale: FolderLocale
  folders?: { generated: string; materials: string }
  draft: boolean
  mainVideoEditId?: string | null
  memories?: MemoryEntry[]
  foreign?: ContentTrustReference
}

/** 按固定字段顺序组装项目说明；草稿标记与主剪辑只在有值时写出。 */
export function buildProjectManifest(fields: ProjectManifestFields): ProjectManifest {
  return {
    format: PROJECT_MANIFEST_FORMAT,
    version: PROJECT_MANIFEST_VERSION,
    minReaderVersion: 1,
    id: fields.id,
    createdAt: fields.createdAt,
    locale: fields.locale,
    ...(fields.foreign ? { foreign: fields.foreign } : {}),
    folders: { ...(fields.folders ?? PROJECT_FOLDER_NAMES[fields.locale]) },
    ...(fields.memories ? { memories: projectMemoryEntriesSchema.parse(fields.memories) } : {}),
    ...(fields.draft ? { draft: true as const } : {}),
    ...(fields.mainVideoEditId ? { mainVideoEditId: fields.mainVideoEditId } : {}),
  }
}

export function projectManifestContract(): PersistenceContract {
  return { id: 'project', name: '项目说明', version: PROJECT_MANIFEST_VERSION, schema: projectManifestSchema, migrations: formatMigrations('project') }
}

export function parseProjectManifest(raw: unknown, backupPath?: string): ProjectManifest {
  const version = raw && typeof raw === 'object' && 'version' in raw ? Number(raw.version) : PROJECT_MANIFEST_VERSION
  const contract = projectManifestContract()
  const upgraded = version !== contract.version ? upgradePersistenceContent(contract, raw, version, backupPath, projectManifestMinReader(raw)) : migratePersistenceContent(contract, raw, version, backupPath)
  const result = projectManifestSchema.safeParse(upgraded)
  if (!result.success) {
    throw new ProjectManifestError(`项目说明无效：${result.error.issues[0]?.message ?? '格式错误'}`, { cause: result.error })
  }
  const { draft, mainVideoEditId, ...rest } = result.data
  return buildProjectManifest({ ...rest, draft: draft === true, mainVideoEditId })
}

function projectManifestMinReader(raw: unknown): number | undefined {
  return raw && typeof raw === 'object' && 'minReaderVersion' in raw && typeof raw.minReaderVersion === 'number' ? raw.minReaderVersion : undefined
}

/**
 * 写回项目说明前对照磁盘上的现有说明：更新版本写出、本程序可读的说明保留原版本戳与本程序不认识的字段。
 * 现有说明缺失、无法解析或不是更新版本时，原样返回本次说明。
 */
export function carryProjectManifestForward(existing: unknown, next: ProjectManifest): unknown {
  if (!existing) return next
  let raw: unknown = existing
  if (typeof existing === 'string') {
    try { raw = JSON.parse(existing.charCodeAt(0) === 0xfeff ? existing.slice(1) : existing) as unknown } catch { return next }
  }
  const version = raw && typeof raw === 'object' && 'version' in raw ? Number(raw.version) : 0
  if (!(version > PROJECT_MANIFEST_VERSION)) return next
  try {
    const fields = persistenceForwardFields(upgradePersistenceContent(projectManifestContract(), raw, version, undefined, projectManifestMinReader(raw)))
    return { ...restoreForwardFields(next, fields), version, minReaderVersion: projectManifestMinReader(raw) }
  } catch { return next }
}

export function parseProjectManifestText(text: string, backupPath?: string): ProjectManifest {
  let raw: unknown
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch (error) {
    throw new ProjectManifestError('项目说明已损坏，无法读取。', { cause: error })
  }
  return parseProjectManifest(raw, backupPath)
}

export function serializeProjectManifest(manifest: unknown): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

/**
 * 没有项目说明的文件夹（手动建的、旧版留下的）按已有子文件夹推断语言：
 * 有“生成结果 / 素材”用中文，有“Generated / Media”用英文，都没有时用作品目录的语言。
 */
export function inferProjectLocale(entryNames: readonly string[], fallback: FolderLocale): FolderLocale {
  const names = new Set(entryNames.map((name) => name.toLowerCase()))
  for (const locale of ['zh', 'en'] as const) {
    const folders = PROJECT_FOLDER_NAMES[locale]
    if (names.has(folders.generated.toLowerCase()) || names.has(folders.materials.toLowerCase())) return locale
  }
  return fallback
}
