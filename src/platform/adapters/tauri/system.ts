import {
  copyFile,
  exists,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { open as openShell } from '@tauri-apps/plugin-shell'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { appLocalDataDir, dirname, downloadDir, join } from '@tauri-apps/api/path'
import type {
  DialogOpenOptions,
  DialogPlatform,
  DialogSaveOptions,
  FsPlatform,
  HttpPlatform,
  PathsPlatform,
  ShellPlatform,
  SystemPlatform,
} from '@/platform/contracts/system'

function createFs(): FsPlatform {
  return {
    readFile: (path) => readFile(path),
    readTextFile: (path) => readTextFile(path),
    writeFile: (path, data) => writeFile(path, data),
    writeTextFile: (path, data) => writeTextFile(path, data),
    exists: (path) => exists(path),
    mkdir: (path, options) => mkdir(path, options),
    readDir: async (path) => (await readDir(path)).map((entry) => entry.name ?? ''),
    copyFile: (src, dest) => copyFile(src, dest),
    remove: (path) => remove(path),
  }
}

function createDialog(): DialogPlatform {
  return {
    save: (options?: DialogSaveOptions) => saveDialog(options),
    open: (options?: DialogOpenOptions) => openDialog(options),
  }
}

function createShell(): ShellPlatform {
  return {
    openExternal: (url) => openShell(url),
  }
}

function createPaths(): PathsPlatform {
  return {
    appLocalDataDir: () => appLocalDataDir(),
    downloadDir: () => downloadDir(),
    join: (...parts) => join(...parts),
    dirname: (path) => dirname(path),
  }
}

function createHttp(): HttpPlatform {
  return {
    fetch: (url, init) => tauriFetch(url, init),
  }
}

export function createTauriSystem(): SystemPlatform {
  return {
    fs: createFs(),
    dialog: createDialog(),
    shell: createShell(),
    paths: createPaths(),
    http: createHttp(),
  }
}
