export interface FsDirEntry {
  name: string
  isDirectory: boolean
  unreadable?: boolean
}

export interface FsDirPage { entries: FsDirEntry[]; realPath: string; cursor?: string }
export interface FsDirPageOptions { cursor?: string; close?: boolean }

export interface FsPlatform {
  readFile(path: string, options?: { maxBytes: number }): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array, options?: { exclusive?: boolean; position?: number }): Promise<void>
  writeTextFile(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readDir(path: string): Promise<FsDirEntry[]>
  readDirPage(path: string, options?: FsDirPageOptions): Promise<FsDirPage>
  copyFile(src: string, dest: string): Promise<void>
  remove(path: string, options?: { recursive?: boolean }): Promise<void>
}

export interface DialogSaveOptions {
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface DialogOpenOptions {
  directory?: boolean
  multiple?: boolean
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface DialogPlatform {
  save(options?: DialogSaveOptions): Promise<string | null>
  open(options?: DialogOpenOptions): Promise<string | string[] | null>
}

export interface ShellPlatform {
  openExternal(url: string): Promise<void>
}

export type UserFolderKey = 'projects' | 'generated' | 'uploads' | 'exports' | 'skills'

/** 程序目录与用户目录快照；唯一来源是主进程 `electron/main/services/appPaths.ts`。 */
export interface AppDirectories {
  /** 程序目录：数据库、密钥、日志、缩略图与各工具内部存储。 */
  programDir: string
  /** 当前用户目录（默认“文档/痕迹AI”，或设置里指定的数据目录）；记录里的相对路径以它为基准。 */
  userRoot: string
  defaultUserRoot: string
  isCustomUserRoot: boolean
  /** 分类文件夹名（首次创建时按语言确定）。 */
  folderNames: Record<UserFolderKey, string>
  folders: Record<UserFolderKey, string>
  thumbnailsDir: string
}

export interface PathsPlatform {
  appLocalDataDir(): Promise<string>
  appDirectories(options?: { uiLanguage?: string }): Promise<AppDirectories>
  downloadDir(): Promise<string>
  join(...parts: string[]): Promise<string>
  dirname(path: string): Promise<string>
  tempDir(): Promise<string>
}

export interface HttpPlatform {
  fetch(url: string, init?: RequestInit): Promise<Response>
}

export interface SystemPlatform {
  fs: FsPlatform
  dialog: DialogPlatform
  shell: ShellPlatform
  paths: PathsPlatform
  http: HttpPlatform
}
