import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import {
  DATA_ROOT_FOLDER,
  getDefaultDataRoot,
  getProgramDataDir,
  getProgramStoreDir,
  PROGRAM_STORE_NAMES,
  readDataLocation,
  resetDataLocationForTest,
  writeDataLocation,
  type UserFolderLocale,
} from './appBasePaths'
import { PROJECT_FOLDER_NAMES, STANDALONE_FOLDER_LOCALE } from '../../../src/core/documents/projectManifest'
import { createMainLogger, type MainLogger } from './logging/main-logger'

export {
  getProgramDataDir,
  getProgramFilePath,
  getProgramStoreDir,
} from './appBasePaths'
export type { UserFolderLocale } from './appBasePaths'

/*
 * 应用目录的唯一来源。
 *
 * 全部数据在一个数据目录里（默认 `<文档>/HenjiAI`，位置记在用户主目录，见 appBasePaths）：
 * - 作品按用途放在固定英文名的分类文件夹里，名称不随界面语言变化；
 * - 程序资料在其中的 `.system`（数据库、密钥、日志、授权清单、缩略图、各工具内部存储与缓存）。
 * 设置里更换数据目录时两者一起搬。
 *
 * `locale` 只决定新建内容的起名语言（“未命名项目”、项目内部文件夹等），首次需要时按界面语言确定。
 *
 * 其他模块只调用这里的函数取目录，不再自行拼接。程序资料部分实现在无依赖的 `appBasePaths.ts`
 * 并由本模块转出；只有日志写入、数据库、密钥、系统这些被本模块间接依赖的底层模块直接引用它，
 * 以免形成模块初始化循环。
 */

export type UserFolderKey = 'projects' | 'generated' | 'uploads' | 'exports' | 'skills'

/**
 * 首次需要数据目录时就建好的分类文件夹。各类文档独立存放的文件夹（画布、口播、镜头参考、图片文档）
 * 与项目的 `.henji/` 由文档底座按文档类型登记在用到时才建（src/core/documents/kinds）。
 */
const USER_FOLDER_KEYS: readonly UserFolderKey[] = [
  'projects', 'generated', 'uploads', 'exports', 'skills',
]

/** 数据目录文件夹名：新建时一律用第一个；其余是早先用过的名字，用户选中这样命名的文件夹时直接用它。 */
export const USER_ROOT_FOLDER_NAMES: readonly string[] = [DATA_ROOT_FOLDER, '痕迹AI', 'Henji AI']

const USER_FOLDER_NAMES: Readonly<Record<UserFolderKey, string>> = {
  projects: 'Projects',
  generated: 'Generated',
  uploads: 'Uploads',
  exports: 'Exports',
  skills: 'Skills',
}

/** 数据目录下各类文档独立存放的文件夹一律用英文名，与起名语言无关。 */
export const USER_ROOT_FOLDER_LOCALE: UserFolderLocale = STANDALONE_FOLDER_LOCALE

let logger: MainLogger | null = null
function getLogger(): MainLogger {
  // 延迟创建：appPaths → db → logging 有函数级循环引用，模块初始化阶段不调用 logging。
  logger ??= createMainLogger('main.app_paths')
  return logger
}

// ==================== 数据目录 ====================

export interface UserDataLayout {
  /** 当前数据目录。 */
  root: string
  /** 默认数据目录（文档/HenjiAI）。 */
  defaultRoot: string
  /** 新建内容的起名语言；分类文件夹名与它无关。 */
  locale: UserFolderLocale
  isCustom: boolean
  folders: Readonly<Record<UserFolderKey, string>>
}

function localeForLanguages(languages: ReadonlyArray<string | null | undefined>): UserFolderLocale {
  const first = languages.map((value) => value?.trim().toLowerCase()).find((value) => Boolean(value))
  if (!first) return 'zh'
  return first.startsWith('zh') ? 'zh' : 'en'
}

let uiLanguageHint: string | null = null

/** 渲染层报告当前界面语言；只影响首次确定起名语言。 */
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

/** 起名语言是否已经确定（全新安装、渲染层还没报告界面语言时为 false）。 */
export function isUserLocaleDecided(): boolean {
  return readDataLocation().locale !== undefined
}

const ensuredUserRoots = new Set<string>()

function ensureUserFolders(layout: UserDataLayout): void {
  if (ensuredUserRoots.has(layout.root)) return
  const existed = fs.existsSync(layout.root)
  try {
    fs.mkdirSync(layout.root, { recursive: true })
    for (const folder of Object.values(layout.folders)) fs.mkdirSync(folder, { recursive: true })
  } catch (error) {
    getLogger().error('创建数据目录失败', {
      event: 'app_paths.user_root.create_failed',
      context: { root: layout.root, isCustom: layout.isCustom },
      error,
    })
    throw error
  }
  ensuredUserRoots.add(layout.root)
  getLogger().info(existed ? '数据目录已就绪' : '已创建数据目录', {
    event: existed ? 'app_paths.user_root.ready' : 'app_paths.user_root.created',
    context: { root: layout.root, isCustom: layout.isCustom },
  })
}

/** 当前数据目录布局；首次调用时确定起名语言并记下，同时创建分类文件夹。 */
export function getUserDataLayout(): UserDataLayout {
  let location = readDataLocation()
  if (!location.locale) {
    location = { ...location, locale: localeForLanguages([uiLanguageHint, ...systemLanguages()]) }
    writeDataLocation(location)
    getLogger().info('已确定新建内容的起名语言', {
      event: 'app_paths.user_root.locale_decided',
      context: { locale: location.locale, languageHint: uiLanguageHint },
    })
  }
  const root = location.root
  const defaultRoot = getDefaultDataRoot()
  const folders = {} as Record<UserFolderKey, string>
  for (const key of USER_FOLDER_KEYS) folders[key] = path.join(root, USER_FOLDER_NAMES[key])
  const layout: UserDataLayout = {
    root,
    defaultRoot,
    locale: location.locale ?? 'zh',
    isCustom: path.relative(root, defaultRoot) !== '',
    folders,
  }
  ensureUserFolders(layout)
  return layout
}

export function getUserRootDir(): string {
  return getUserDataLayout().root
}

/** 数据目录下的分类文件夹；不存在时创建（用户可能在运行期间删掉了它）。 */
export function getUserFolderDir(key: UserFolderKey): string {
  const dir = getUserDataLayout().folders[key]
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 本地模型文件夹（任务 4.11）：不在首次创建的分类文件夹里，第一次下载模型时才建。
 * 每个模型一个子文件夹，用户能看懂、能手动删除（子文件夹名按起名语言取）；程序读取前按清单校验。
 */
export function getUserModelsLocation(): { dir: string; locale: UserFolderLocale } {
  const layout = getUserDataLayout()
  return { dir: path.join(layout.root, 'Models'), locale: layout.locale }
}

/** 录音与口播拼接结果的文件夹；用到时由使用方创建。 */
export const USER_AUDIO_RECORDINGS_FOLDER = 'Audio Recordings'
export function getUserAudioRecordingsDir(): string {
  return path.join(getUserDataLayout().root, USER_AUDIO_RECORDINGS_FOLDER)
}

/** 媒体协议按文件夹名判断内容寻址缓存：缩略图、数据目录的生成结果与上传素材、项目里的生成结果（两种起名语言）。 */
export const CONTENT_ADDRESSED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  PROGRAM_STORE_NAMES.thumbnails, USER_FOLDER_NAMES.generated, USER_FOLDER_NAMES.uploads,
  ...Object.values(PROJECT_FOLDER_NAMES).map((names) => names.generated),
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
    folderNames: { ...USER_FOLDER_NAMES },
    folders: { ...layout.folders },
    thumbnailsDir: getProgramStoreDir('thumbnails'),
  }
}

export function resetAppPathsForTest(): void {
  uiLanguageHint = null
  ensuredUserRoots.clear()
  resetDataLocationForTest()
}
