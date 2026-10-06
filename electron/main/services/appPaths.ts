import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { getProgramDataDir, getProgramStoreDir, PROGRAM_STORE_NAMES } from './appBasePaths'
import { readUserDataRootSettings, writePersistedDefaultUserDataRoot } from './dataRoot'
import { createMainLogger, type MainLogger } from './logging/main-logger'

export {
  APP_IDENTIFIER,
  getAppBaseDir,
  getProgramDataDir,
  getProgramFilePath,
  getProgramStoreDir,
  PROGRAM_DATA_DIR_NAME,
  type ProgramStoreKey,
} from './appBasePaths'

/*
 * 应用目录的唯一来源（重要记录 001、002、008）。
 *
 * - 基础目录：Windows `%LOCALAPPDATA%\com.henji.ai`，其他平台 `<appData>/com.henji.ai`。
 *   自动化隔离由 `HENJI_ISOLATED_APP_DATA`（主进程 ready 前重定向 appData）与启动器覆盖的
 *   LOCALAPPDATA 共同保证，这里不另设分支。
 * - 程序目录 `<基础目录>/Henji-AI`：数据库、密钥、日志、授权清单、缩略图、各工具内部存储与缓存。
 *   用户不需要碰，也不随“数据目录”设置移动。
 * - 用户目录：默认系统“文档”下的“痕迹AI”（英文界面首次创建时为“Henji AI”），只放用户作品，
 *   按用途分类。名称在首次创建时确定并写入 settings，之后不随界面语言变化。
 *   设置里指定了数据目录时，用户目录改为该目录，分类文件夹照样建在它下面。
 *
 * 其他模块只调用这里的函数取目录，不再自行拼接基础目录或分类文件夹名。
 * 程序目录部分实现在无依赖的 `appBasePaths.ts` 并由本模块转出；只有日志写入、数据库、密钥、
 * 系统这些被本模块间接依赖的底层模块直接引用它，以免形成模块初始化循环。
 */

export type UserFolderLocale = 'zh' | 'en'
export type UserFolderKey = 'projects' | 'generated' | 'uploads' | 'exports' | 'skills'

/**
 * 首次需要用户目录时就建好的分类文件夹。各类文档独立存放的文件夹（画布、口播、镜头参考、图片文档）
 * 与作品目录的 `.henji/` 由文档底座按文档类型登记在用到时才建（src/core/documents/kinds）。
 */
export const USER_FOLDER_KEYS: readonly UserFolderKey[] = [
  'projects', 'generated', 'uploads', 'exports', 'skills',
]

export const USER_ROOT_FOLDER_NAMES: Readonly<Record<UserFolderLocale, string>> = {
  zh: '痕迹AI',
  en: 'Henji AI',
}

export const USER_FOLDER_NAMES: Readonly<Record<UserFolderLocale, Readonly<Record<UserFolderKey, string>>>> = {
  zh: {
    projects: '项目',
    generated: '生成结果',
    uploads: '上传素材',
    exports: '导出',
    skills: '助手技能',
  },
  en: {
    projects: 'Projects',
    generated: 'Generated',
    uploads: 'Uploads',
    exports: 'Exports',
    skills: 'Assistant Skills',
  },
}

let logger: MainLogger | null = null
function getLogger(): MainLogger {
  // 延迟创建：appPaths → dataRoot → db → logging 有函数级循环引用，模块初始化阶段不调用 logging。
  logger ??= createMainLogger('main.app_paths')
  return logger
}

// ==================== 用户目录 ====================

export interface PersistedUserDataRoot {
  root: string
  locale: UserFolderLocale
}

export interface UserDataLayout {
  /** 当前用户目录（自定义目录优先）。 */
  root: string
  /** 默认用户目录（文档/痕迹AI），首次确定后不变。 */
  defaultRoot: string
  locale: UserFolderLocale
  isCustom: boolean
  folders: Readonly<Record<UserFolderKey, string>>
}

export interface ResolveUserDataLayoutInput {
  customRoot: string | null
  persisted: PersistedUserDataRoot | null
  /** 只在首次确定默认目录时调用。 */
  documentsDir: () => string
  /** 只在首次确定默认目录时调用；按优先级排列，取第一个有效值。 */
  languages: () => ReadonlyArray<string | null | undefined>
}

export interface ResolvedUserDataLayout {
  layout: UserDataLayout
  /** 首次确定默认目录时需要写入 settings 的值；已确定时为 null。 */
  persist: PersistedUserDataRoot | null
}

export function folderLocaleForLanguages(languages: ReadonlyArray<string | null | undefined>): UserFolderLocale {
  const first = languages.map((value) => value?.trim().toLowerCase()).find((value) => Boolean(value))
  if (!first) return 'zh'
  return first.startsWith('zh') ? 'zh' : 'en'
}

export function parsePersistedUserDataRoot(raw: string | null): PersistedUserDataRoot | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    const root = typeof record.root === 'string' ? record.root.trim() : ''
    const locale = record.locale
    if (!root || !path.isAbsolute(root) || (locale !== 'zh' && locale !== 'en')) return null
    return { root, locale }
  } catch {
    return null
  }
}

export function buildUserFolders(root: string, locale: UserFolderLocale): Record<UserFolderKey, string> {
  const names = USER_FOLDER_NAMES[locale]
  const folders = {} as Record<UserFolderKey, string>
  for (const key of USER_FOLDER_KEYS) folders[key] = path.join(root, names[key])
  return folders
}

/** 纯函数：根据设置决定用户目录布局，不读写磁盘与数据库。 */
export function resolveUserDataLayout(input: ResolveUserDataLayoutInput): ResolvedUserDataLayout {
  let persist: PersistedUserDataRoot | null = null
  let defaults = input.persisted
  if (!defaults) {
    const locale = folderLocaleForLanguages(input.languages())
    defaults = { root: path.join(input.documentsDir(), USER_ROOT_FOLDER_NAMES[locale]), locale }
    persist = defaults
  }
  const customRoot = input.customRoot?.trim() || null
  const root = customRoot ?? defaults.root
  return {
    layout: {
      root,
      defaultRoot: defaults.root,
      locale: defaults.locale,
      isCustom: customRoot !== null,
      folders: buildUserFolders(root, defaults.locale),
    },
    persist,
  }
}

/** 系统“文档”目录；隔离测试环境下改到隔离资料目录内，不写用户真实文档。 */
export function getSystemDocumentsDir(): string {
  const isolated = process.env['HENJI_ISOLATED_APP_DATA']?.trim()
  if (isolated) return path.join(isolated, 'Documents')
  try {
    const documents = app.getPath('documents')
    if (documents) return documents
  } catch (error) {
    getLogger().warn('读取系统文档目录失败，改用主目录下的 Documents', {
      event: 'app_paths.documents_dir.fallback',
      error,
    })
  }
  return path.join(app.getPath('home'), 'Documents')
}

let uiLanguageHint: string | null = null

/** 渲染层报告当前界面语言；只影响首次确定默认目录名称。 */
export function setUserFolderLanguageHint(language: string | null | undefined): void {
  const value = language?.trim()
  if (value) uiLanguageHint = value
}

function systemLanguages(): string[] {
  const languages: string[] = []
  try {
    languages.push(...(app.getPreferredSystemLanguages?.() ?? []))
  } catch {
    // 平台不支持时退回 getLocale。
  }
  try {
    languages.push(app.getLocale())
  } catch {
    // ready 之前可能不可用。
  }
  return languages
}

const ensuredUserRoots = new Set<string>()

function ensureUserFolders(layout: UserDataLayout): void {
  const key = `${layout.root}\0${layout.locale}`
  if (ensuredUserRoots.has(key)) return
  const existed = fs.existsSync(layout.root)
  try {
    fs.mkdirSync(layout.root, { recursive: true })
    for (const folder of Object.values(layout.folders)) fs.mkdirSync(folder, { recursive: true })
  } catch (error) {
    getLogger().error('创建用户目录失败', {
      event: 'app_paths.user_root.create_failed',
      context: { root: layout.root, isCustom: layout.isCustom, locale: layout.locale },
      error,
    })
    throw error
  }
  ensuredUserRoots.add(key)
  getLogger().info(existed ? '用户目录已就绪' : '已创建用户目录', {
    event: existed ? 'app_paths.user_root.ready' : 'app_paths.user_root.created',
    context: { root: layout.root, isCustom: layout.isCustom, locale: layout.locale },
  })
}

/** 当前用户目录布局；首次调用时确定默认目录并写入 settings，同时创建分类文件夹。 */
export function getUserDataLayout(): UserDataLayout {
  const settings = readUserDataRootSettings()
  const { layout, persist } = resolveUserDataLayout({
    customRoot: settings.customRoot,
    persisted: parsePersistedUserDataRoot(settings.persistedDefault),
    documentsDir: getSystemDocumentsDir,
    languages: () => [uiLanguageHint, ...systemLanguages()],
  })
  if (persist) {
    writePersistedDefaultUserDataRoot(JSON.stringify(persist))
    getLogger().info('已确定默认用户目录', {
      event: 'app_paths.user_root.default_decided',
      context: { root: persist.root, locale: persist.locale, languageHint: uiLanguageHint },
    })
  }
  ensureUserFolders(layout)
  return layout
}

export function getUserRootDir(): string {
  return getUserDataLayout().root
}

/** 用户目录下的分类文件夹；不存在时创建（用户可能在运行期间删掉了它）。 */
export function getUserFolderDir(key: UserFolderKey): string {
  const dir = getUserDataLayout().folders[key]
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 本地模型文件夹（任务 4.11）：不在首次创建的分类文件夹里，第一次下载模型时才建。
 * 每个模型一个子文件夹，用户能看懂、能手动删除；程序读取前按清单校验。
 */
export const USER_MODELS_FOLDER_NAMES: Readonly<Record<UserFolderLocale, string>> = {
  zh: '模型',
  en: 'Models',
}

/** 本地模型总文件夹与其语言（子文件夹名按同一语言取）；不创建目录。 */
export function getUserModelsLocation(): { dir: string; locale: UserFolderLocale } {
  const layout = getUserDataLayout()
  return { dir: path.join(layout.root, USER_MODELS_FOLDER_NAMES[layout.locale]), locale: layout.locale }
}

/** 媒体协议按文件夹名判断内容寻址缓存；包含两种语言的生成结果、上传素材与缩略图目录名。 */
export const CONTENT_ADDRESSED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  PROGRAM_STORE_NAMES.thumbnails,
  ...(['zh', 'en'] as const).flatMap((locale) => [USER_FOLDER_NAMES[locale].generated, USER_FOLDER_NAMES[locale].uploads]),
])

// ==================== 渲染层快照 ====================

export interface AppDirectoriesDto {
  programDir: string
  userRoot: string
  defaultUserRoot: string
  isCustomUserRoot: boolean
  folderNames: Record<UserFolderKey, string>
  folders: Record<UserFolderKey, string>
  thumbnailsDir: string
}

export function getAppDirectories(): AppDirectoriesDto {
  const layout = getUserDataLayout()
  return {
    programDir: getProgramDataDir(),
    userRoot: layout.root,
    defaultUserRoot: layout.defaultRoot,
    isCustomUserRoot: layout.isCustom,
    folderNames: { ...USER_FOLDER_NAMES[layout.locale] },
    folders: { ...layout.folders },
    thumbnailsDir: getProgramStoreDir('thumbnails'),
  }
}

export function resetAppPathsForTest(): void {
  uiLanguageHint = null
  ensuredUserRoots.clear()
}
