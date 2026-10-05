import { app } from 'electron'
import path from 'node:path'

/*
 * 程序目录：唯一路径模块 `appPaths.ts` 的无依赖底层（只依赖 electron 与 node:path）。
 * 日志写入、数据库、密钥、系统等被 appPaths 间接依赖的底层模块直接引用本文件，
 * 其余模块一律从 `appPaths.ts` 取目录。
 *
 * 基础目录：Windows `%LOCALAPPDATA%\com.henji.ai`，其他平台 `<appData>/com.henji.ai`。
 * 自动化隔离由 `HENJI_ISOLATED_APP_DATA`（主进程 ready 前重定向 appData）与启动器覆盖的
 * LOCALAPPDATA 共同保证。程序目录 `<基础目录>/Henji-AI` 放数据库、密钥、日志、缩略图与各工具
 * 内部存储，不随“数据目录”设置移动（重要记录 002）。
 */

export const APP_IDENTIFIER = 'com.henji.ai'
export const PROGRAM_DATA_DIR_NAME = 'Henji-AI'

/** 程序目录下的内部存储；名称沿用现有目录，保证已有缓存与文档继续可用。 */
export type ProgramStoreKey = 'logs' | 'thumbnails' | 'imageEditor' | 'audioEdit' | 'documentStore' | 'debug' | 'downloads'

export const PROGRAM_STORE_NAMES: Readonly<Record<ProgramStoreKey, string>> = {
  logs: 'logs',
  thumbnails: 'Thumbnails',
  imageEditor: 'ImageEditorV3',
  audioEdit: 'AudioEdit',
  /** 文档底座的内部存储：跨进程文档锁、通用封面（按文档 ID）。 */
  documentStore: 'DocumentStore',
  debug: 'debug',
  downloads: 'Downloads',
}

export function getAppBaseDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER)
  }
  return path.join(app.getPath('appData'), APP_IDENTIFIER)
}

export function getProgramDataDir(): string {
  return path.join(getAppBaseDir(), PROGRAM_DATA_DIR_NAME)
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
