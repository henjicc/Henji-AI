import type Database from 'better-sqlite3'

import {
  createLocationCodec,
  type LocationCodec,
  type LocationContext,
  type LocationReport,
} from '../../../src/core/storage/locationCodec'
import path from 'node:path'

import { getProgramDataDir, getUserRootDir } from './appPaths'
import { getDb, getHenjiDataDir } from './db'
import type { SchemaMigrationOptions } from './db-migrations'
import { DocumentIndexStore } from './documents/index-store'
import { createMainLogger, type MainLogger } from './logging/main-logger'

/*
 * 数据库记录里的文件位置换算（实施方案 2.5，存储底座 2.3）。
 *
 * 各数据库仓库写入时把落在作品目录或项目里的绝对路径换成 `henji://user/…`、`henji://project/<ID>/…`，
 * 外部文件原样保留；读出时换回绝对路径。数据库记录不使用 `henji:/`（容器写法只在文档文件里）。
 * 结果：换作品目录、移动或拷贝项目文件夹后，数据库里的记录不需要任何改写。
 *
 * 一次 `use` 内共用同一份换算上下文（作品目录、已知项目），并且只在第一次真正换算时才解析，
 * 不会因为读一条不含路径的记录就提前确定作品目录。
 */

const STYLE = process.platform === 'win32' ? 'win32' : 'posix'
/** 与 locationCodec 的路径预判一致：不像路径的值不用解析换算上下文。 */
const MAY_ENCODE = /^(?:[A-Za-z]:[\\/]|[\\/]|henji-media:|file:)/i

/** 整份内容的预判（在 JSON 文本上找像路径的字符串），没有就不解析换算上下文、原样返回。 */
const MAY_ENCODE_JSON = /"(?:[A-Za-z]:(?:\\\\|\/)|\\\\|\/|henji-media:|file:)/i

function mayEncodeContent(value: unknown): boolean {
  if (typeof value === 'string') return MAY_ENCODE.test(value)
  return MAY_ENCODE_JSON.test(JSON.stringify(value) ?? '')
}

function mayDecodeContent(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith('henji:')
  return (JSON.stringify(value) ?? '').includes('"henji:')
}

export interface LocationScope {
  /** 单个路径：绝对路径 → 位置写法；不是路径的字符串原样返回。 */
  encodePath(value: string): string
  /** 单个存储值：位置写法 → 绝对路径；无法解析（项目不在等）原样返回并记日志。 */
  decodePath(value: string): string
  /** 整份 JSON 内容（遍历所有字符串值与对象键）。 */
  encodeValue(value: unknown): unknown
  decodeValue(value: unknown): unknown
}

export interface DatabaseLocations {
  use<T>(run: (scope: LocationScope) => T): T
}

/** 已知项目：作品索引里的全部项目（含暂时缺失的，解码时仍能给出原位置）。 */
export function listLocationProjects(db: Database.Database): LocationContext['projects'] {
  return new DocumentIndexStore(db, STYLE).listProjects().map((project) => ({ id: project.id, root: project.path }))
}

/** 正式运行环境的换算上下文：作品目录来自 appPaths，项目来自作品索引。 */
export function databaseLocationContext(db: Database.Database): LocationContext {
  return { style: STYLE, userRoot: getUserRootDir(), projects: listLocationProjects(db), programRoots: [getProgramDataDir()] }
}

let logger: MainLogger | null = null
function getLogger(): MainLogger {
  logger ??= createMainLogger('main.db.locations')
  return logger
}

function reportUnresolved(report: LocationReport): void {
  if (report.unresolved.length === 0) return
  getLogger().warn('数据库记录里有无法解析的位置，已原样保留', {
    event: 'db.locations.unresolved',
    context: {
      count: report.unresolved.length,
      reasons: [...new Set(report.unresolved.map((item) => item.reason))],
      projectIds: [...new Set(report.unresolved.map((item) => item.projectId).filter(Boolean))].slice(0, 10),
    },
  })
}

export function createDatabaseLocations(context: () => LocationContext): DatabaseLocations {
  return {
    use<T>(run: (scope: LocationScope) => T): T {
      let codec: LocationCodec | null = null
      const get = (): LocationCodec => {
        codec ??= createLocationCodec(context())
        return codec
      }
      // 只收集解码时无法解析的位置；一次 use 结束后合并记一条日志。
      const unresolved: LocationReport = { references: [], programReferences: [], unresolved: [] }
      const scope: LocationScope = {
        encodePath: (value) => (MAY_ENCODE.test(value) ? get().encode(value).stored : value),
        decodePath: (value) => {
          if (!value.startsWith('henji:')) return value
          const result = get().decode(value)
          if (result.unresolved) unresolved.unresolved.push(result.unresolved)
          return result.value
        },
        encodeValue: (value) => (mayEncodeContent(value) ? get().encodeContent(value).content : value),
        decodeValue: (value) => {
          if (!mayDecodeContent(value)) return value
          const result = get().decodeContent(value)
          unresolved.unresolved.push(...result.report.unresolved)
          return result.content
        },
      }
      const result = run(scope)
      reportUnresolved(unresolved)
      return result
    },
  }
}

/** 正式运行环境的迁移参数：位置换算用当前作品目录与作品索引，破坏性迁移前备份到程序目录 backups/。主进程入口启动时登记。 */
export function databaseMigrationOptions(conn: Database.Database): SchemaMigrationOptions {
  return {
    locationContext: () => databaseLocationContext(conn),
    backupDirectory: path.join(getHenjiDataDir(), 'backups'),
  }
}

/** 正式运行环境的唯一实例：henji.db 与当前作品目录。 */
export const databaseLocations: DatabaseLocations = createDatabaseLocations(() => databaseLocationContext(getDb()))
