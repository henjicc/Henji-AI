export interface FsDirEntry {
  name: string
  isDirectory: boolean
}

export interface FsPlatform {
  readFile(path: string): Promise<Uint8Array>
  readTextFile(path: string): Promise<string>
  writeFile(path: string, data: Uint8Array): Promise<void>
  writeTextFile(path: string, data: string): Promise<void>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  readDir(path: string): Promise<FsDirEntry[]>
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

export interface PathsPlatform {
  appLocalDataDir(): Promise<string>
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
