import type { DatabaseLocations, LocationScope } from './db-locations'

/*
 * 不做位置换算的替身（只给测试用）：只关心表逻辑、不关心路径写法的测试使用。
 * 单独成文件且只引用类型，供 `vi.mock('../db-locations', …)` 的工厂函数导入而不形成循环。
 */

const IDENTITY_SCOPE: LocationScope = {
  encodePath: (value) => value,
  decodePath: (value) => value,
  encodeValue: (value) => value,
  decodeValue: (value) => value,
}

export const identityDatabaseLocations: DatabaseLocations = {
  use: (run) => run(IDENTITY_SCOPE),
}
