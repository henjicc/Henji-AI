import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/*
 * 数据位置的无依赖底层（只依赖 electron 与 node 内置模块）：唯一路径模块 `appPaths.ts` 建在它上面。
 * 日志写入、数据库、密钥、系统等被 appPaths 间接依赖的底层模块直接引用本文件，
 * 其余模块一律从 `appPaths.ts` 取目录。
 *
 * 全部数据放在一个“数据目录”里（默认 `<文档>/HenjiAI`，用户可在设置里换）：
 * - 作品按用途分在英文分类文件夹里（见 appPaths）；
 * - 程序资料（数据库、密钥、配置、助手、日志、回收区、各工具内部存储与缓存）在其中的 `.system`。
 *
 * 数据目录在哪记在用户主目录的 `~/.henji-ai/location.json`。它不能放系统的应用数据目录：
 * Windows 会把打包应用（及其子进程）对应用数据目录的写入转存到应用私有位置，同一台机器上
 * 从不同入口启动会读到两份不同的数据；也不能放数据库，数据库自己就在数据目录里。
 *
 * 自动化隔离：`HENJI_DATA_ROOT` 直接指定数据目录（位置只在内存里）；`HENJI_ISOLATED_APP_DATA` 时位置文件与
 * 默认数据目录都在隔离目录内。两者都不碰用户主目录里的位置文件与真实数据。
 */

const DATA_ROOT_FOLDER_NAME = 'HenjiAI'
const SYSTEM_DIR_NAME = '.system'
const LOCATION_DIR_NAME = '.henji-ai'
const LOCATION_FILE_NAME = 'location.json'
const DATABASE_FILE_NAME = 'henji.db'

export type UserFolderLocale = 'zh' | 'en'

export interface DataLocation {
  /** 数据目录（绝对路径）。 */
  root: string
  /**
   * 程序资料目录还没跟着搬到数据目录时的实际位置：更换数据目录时数据库等文件正被本进程占用，
   * 作品先搬、位置先切，程序资料留在原处到下次启动再搬。缺省即 `<root>/.system`。
   */
  systemDir?: string
  /** 新建内容起名用的语言（“未命名项目”等）；首次需要时按界面语言确定。分类文件夹名固定英文，与它无关。 */
  locale?: UserFolderLocale
}

/** 单元测试等直接指定数据目录：位置只在内存里，不读写任何位置文件。 */
function explicitRoot(): string | null {
  const explicit = process.env['HENJI_DATA_ROOT']?.trim()
  return explicit ? path.resolve(explicit) : null
}

/** 隔离运行（自动化验收）用隔离目录里自己的位置文件与默认位置，更换数据目录、重启后搬程序资料都能照常走通。 */
function isolatedBase(): string | null {
  return process.env['HENJI_ISOLATED_APP_DATA']?.trim() || null
}

function locationFilePath(): string {
  return path.join(isolatedBase() ?? os.homedir(), LOCATION_DIR_NAME, LOCATION_FILE_NAME)
}

/** 系统“文档”目录；ready 之前或平台取不到时退到主目录下的 Documents。 */
function systemDocumentsDir(): string {
  try {
    const documents = app.getPath('documents')
    if (documents) return documents
  } catch {
    // 退到主目录。
  }
  return path.join(os.homedir(), 'Documents')
}

export function getDefaultDataRoot(): string {
  const explicit = explicitRoot()
  if (explicit) return explicit
  const isolated = isolatedBase()
  return path.join(isolated ? path.join(isolated, 'Documents') : systemDocumentsDir(), DATA_ROOT_FOLDER_NAME)
}

function parseLocation(raw: string): DataLocation | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const root = typeof value.root === 'string' ? value.root.trim() : ''
    if (!root || !path.isAbsolute(root)) return null
    const systemDir = typeof value.systemDir === 'string' && path.isAbsolute(value.systemDir) ? value.systemDir : undefined
    const locale = value.locale === 'zh' || value.locale === 'en' ? value.locale : undefined
    return { root, ...(systemDir ? { systemDir } : {}), ...(locale ? { locale } : {}) }
  } catch {
    return null
  }
}

let cached: { file: string; location: DataLocation } | null = null
/** 直接指定数据目录时的内存状态（起名语言等）。 */
let explicitState: DataLocation | null = null
/** 等用户选数据目录期间的临时位置：这段时间里的零星写入（日志、浏览器状态）不落到任何真实数据目录。 */
let setupLocation: DataLocation | null = null

/** 这个文件夹是不是一份已有的数据目录（认程序资料里的数据库）。 */
export function hasDataAt(root: string): boolean {
  return fs.existsSync(path.join(root, SYSTEM_DIR_NAME, DATABASE_FILE_NAME))
}

function readLocationFile(file: string): { raw: string | null; location: DataLocation | null } {
  let raw: string | null = null
  try { raw = fs.readFileSync(file, 'utf8') } catch { /* 没有位置文件。 */ }
  return { raw, location: raw === null ? null : parseLocation(raw) }
}

/**
 * 启动时判断数据目录是否已经确定。不能悄悄新建一份空数据让人以为数据丢了，所以这些情况交给用户决定
 * （新建，或指向已有的数据目录）：
 * - 位置文件丢失，且默认位置没有数据（默认位置已有数据就直接用它并补写位置文件）；
 * - 位置文件读不懂（原文件另存为 `.bad`，里面可能还认得出原来的路径）；
 * - 位置文件指向的数据目录已经不在了（换了盘符、移动硬盘没插）。
 * 隔离运行与直接指定数据目录时始终就绪。
 */
export function inspectDataLocation(): 'ready' | 'needs_choice' {
  if (explicitRoot() || isolatedBase()) return 'ready'
  const file = locationFilePath()
  const { raw, location } = readLocationFile(file)
  if (location) return fs.existsSync(location.root) || location.systemDir ? 'ready' : 'needs_choice'
  if (raw !== null) return 'needs_choice'
  const defaultRoot = getDefaultDataRoot()
  if (!hasDataAt(defaultRoot)) return 'needs_choice'
  writeDataLocation({ root: defaultRoot })
  return 'ready'
}

/** 进入“等用户选数据目录”：在此期间数据位置指向一个临时文件夹，返回它供结束时清理。 */
export function beginDataLocationSetup(): string {
  const root = path.join(os.tmpdir(), `henji-ai-setup-${process.pid}`)
  setupLocation = { root }
  return root
}

/**
 * 当前数据位置。隔离运行时位置文件不存在就用默认位置并写下来。
 * 正常运行时由启动流程先确定位置（inspectDataLocation）；没走启动流程的进程（助手命令行等）读不到位置文件时
 * 只在内存里用默认位置，不写位置文件，留给主应用下次启动时让用户决定。
 * 位置文件存在但读不懂时不改写它：那里记着用户的数据在哪，覆盖掉就再也找不回来。
 */
export function readDataLocation(): DataLocation {
  const explicit = explicitRoot()
  if (explicit) {
    if (explicitState?.root !== explicit) explicitState = { root: explicit }
    return explicitState
  }
  if (setupLocation) return setupLocation
  const file = locationFilePath()
  if (cached?.file === file) return cached.location
  const { raw, location: stored } = readLocationFile(file)
  let location = stored
  if (!location) {
    location = { root: getDefaultDataRoot() }
    if (raw === null && isolatedBase()) persistLocation(file, location)
  }
  cached = { file, location }
  return location
}

function persistLocation(file: string, location: DataLocation): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, ...location }, null, 2)}
`)
  fs.renameSync(temporary, file)
}

/** 改写数据位置（更换数据目录、确定起名语言、程序资料搬完）。 */
export function writeDataLocation(location: DataLocation): void {
  if (explicitRoot()) { explicitState = { ...location, root: explicitRoot()! }; return }
  const file = locationFilePath()
  // 读不懂的旧位置文件先另存一份再改写。
  const previous = readLocationFile(file)
  if (previous.raw !== null && !previous.location) {
    try { fs.copyFileSync(file, `${file}.bad`) } catch { /* 另存失败不阻止写入新位置。 */ }
  }
  persistLocation(file, location)
  setupLocation = null
  cached = { file, location }
}

/**
 * 记下起名语言。位置文件还没建立（没走启动流程的进程用着内存里的默认位置）时只记在内存里，
 * 不借机把默认位置写成位置文件。
 */
export function setDataLocale(locale: UserFolderLocale): DataLocation {
  const location = { ...readDataLocation(), locale }
  if (explicitRoot() || setupLocation || readLocationFile(locationFilePath()).location) writeDataLocationKeepingSetup(location)
  else cached = { file: locationFilePath(), location }
  return location
}

function writeDataLocationKeepingSetup(location: DataLocation): void {
  if (setupLocation) { setupLocation = location; return }
  writeDataLocation(location)
}

export function resetDataLocationForTest(): void {
  cached = null
  explicitState = null
  setupLocation = null
}

export function getDataRootDir(): string {
  return readDataLocation().root
}

/** 新建的数据目录文件夹名；用户选的文件夹不是它也不为空时，在里面建这个文件夹。 */
export const DATA_ROOT_FOLDER = DATA_ROOT_FOLDER_NAME
/** 数据目录里的程序资料文件夹名；更换数据目录时它留在原处，下次启动再搬。 */
export const SYSTEM_FOLDER = SYSTEM_DIR_NAME

/** 程序目录下的内部存储；名称沿用现有目录，保证已有缓存与文档继续可用。 */
export type ProgramStoreKey = 'logs' | 'thumbnails' | 'imageEditor' | 'audioEdit' | 'documentStore' | 'debug' | 'downloads' | 'smartRegions' | 'soundLibrary' | 'videoEditCache'

export const PROGRAM_STORE_NAMES: Readonly<Record<ProgramStoreKey, string>> = {
  logs: 'logs',
  thumbnails: 'Thumbnails',
  imageEditor: 'ImageEditorV3',
  audioEdit: 'AudioEdit',
  /** 文档底座的内部存储：跨进程文档锁、通用封面（按文档 ID）。 */
  documentStore: 'DocumentStore',
  debug: 'debug',
  downloads: 'Downloads',
  /** 剪辑智能区域的分析结果（任务 4.7d，按素材内容寻址的缓存，可随时清理）。 */
  smartRegions: 'SmartRegions',
  /** 音效库每个音效的测量与听音向量（按路径、大小、修改时间寻址的缓存，可随时清理）。 */
  soundLibrary: 'SoundLibrary',
  /** 剪辑的可重建派生记录：代码素材参数、播放性能观测（按内容摘要寻址，可随时清理）。 */
  videoEditCache: 'VideoEditCache',
}

/** 程序资料目录：数据库、密钥、日志、回收区、各工具内部存储与缓存，以及助手、风格库等应用级资料。 */
export function getProgramDataDir(): string {
  const location = readDataLocation()
  return location.systemDir ?? path.join(location.root, SYSTEM_DIR_NAME)
}

/** 应用级资料（助手、风格库、代码来源等）的根；与程序资料目录是同一个文件夹。 */
export function getAppBaseDir(): string {
  return getProgramDataDir()
}

/** 程序目录下某个内部存储的路径；不创建目录，由使用方按需创建。 */
export function getProgramStoreDir(store: ProgramStoreKey): string {
  return path.join(getProgramDataDir(), PROGRAM_STORE_NAMES[store])
}

/** 程序目录下的单个文件（数据库、密钥、配置、缓存清单等）。 */
export function getProgramFilePath(fileName: string): string {
  if (!fileName || fileName !== path.basename(fileName)) throw new Error('程序目录文件名不能包含路径')
  return path.join(getProgramDataDir(), fileName)
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isEmptyOrMissingDir(directory: string): boolean {
  try { return fs.readdirSync(directory).length === 0 } catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT' }
}

/**
 * 启动时（任何文件打开之前）把上次更换数据目录时留在原处的程序资料搬进新数据目录。
 * 搬不动（被占用、空间不足、目标里已有程序资料）就继续用原处，下次启动再试，不影响使用。返回值只供启动日志。
 */
export function completePendingSystemMove(): { from: string; to: string; error?: unknown } | null {
  const location = readDataLocation()
  const target = path.join(location.root, SYSTEM_DIR_NAME)
  const from = location.systemDir
  if (!from || path.relative(from, target) === '') return null
  const settled: DataLocation = { root: location.root, ...(location.locale ? { locale: location.locale } : {}) }
  try {
    if (!fs.existsSync(from)) { writeDataLocation(settled); return { from, to: target } }
    // 两份程序资料不能混在一起：目标里已有内容时不搬，继续用原处。
    if (!isEmptyOrMissingDir(target)) throw new Error(`目标位置已有程序资料：${target}`)
    fs.mkdirSync(location.root, { recursive: true })
    try { fs.rmdirSync(target) } catch { /* 目标不存在。 */ }
    let crossDevice = false
    for (let attempt = 0; ; attempt += 1) {
      try { fs.renameSync(from, target); break } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EXDEV') { crossDevice = true; break }
        // 刚重启时上一个实例的子进程可能还没放开文件，稍等再试。
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error
        sleepSync(400)
      }
    }
    if (crossDevice) {
      try {
        fs.cpSync(from, target, { recursive: true, errorOnExist: true, force: false })
      } catch (error) {
        fs.rmSync(target, { recursive: true, force: true })
        throw error
      }
    }
    // 新位置已完整：先切位置再删旧的。旧目录删不干净只是留下垃圾，不能让下次启动拿残缺的旧目录再覆盖一遍。
    writeDataLocation(settled)
    if (crossDevice) {
      try { fs.rmSync(from, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch { /* 留给用户清理。 */ }
    }
    // 旧数据目录只剩空壳时一并删掉。
    try { fs.rmdirSync(path.dirname(from)) } catch { /* 还有别的内容，保留。 */ }
    return { from, to: target }
  } catch (error) {
    return { from, to: target, error }
  }
}
