import path from 'node:path'

import type { LocationContext } from '../../../src/core/storage/locationCodec'
import { createDatabaseLocations, type DatabaseLocations } from './db-locations'
export { identityDatabaseLocations } from './db-locations-identity.test-support'

/*
 * 数据库测试夹具（只给测试用）：位置换算上下文与不做换算的替身。
 * 测试里的绝对路径按当前平台构造（CI 在 Linux 上运行，不写死盘符）。
 */

export const HOST_PATH_STYLE: LocationContext['style'] = process.platform === 'win32' ? 'win32' : 'posix'

/** 以 base 为父目录的作品目录与程序目录。 */
export function testLocationContext(base: string, projects: LocationContext['projects'] = []): LocationContext {
  return {
    style: HOST_PATH_STYLE,
    userRoot: path.join(base, '痕迹AI'),
    projects,
    programRoots: [path.join(base, 'program')],
  }
}

export function testDatabaseLocations(context: LocationContext): DatabaseLocations {
  return createDatabaseLocations(() => context)
}
