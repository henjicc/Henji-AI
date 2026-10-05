import { readRawSettings, writeRawSetting } from './settings/raw'

const CUSTOM_DATA_DIRECTORY_KEY = 'custom_data_directory'
/** 首次创建时确定的默认用户目录（绝对路径 + 分类文件夹语言），之后不随界面语言变化。 */
const USER_DATA_ROOT_KEY = 'user_data_root'

export interface UserDataRootSettings {
  /** 用户在设置里指定的数据目录；未指定为 null。 */
  customRoot: string | null
  /** 已持久化的默认用户目录原始 JSON；首次启动为 null。 */
  persistedDefault: string | null
}

/**
 * 同步读取用户自定义数据根目录（设置表，与渲染层设置接口共用同一行）。
 */
export function getCustomDataRoot(): string | null {
  return readUserDataRootSettings().customRoot
}

/** 供唯一路径模块 `appPaths.ts` 一次读取用户目录相关设置，不走 IPC；这两项是位置换算的基准，原样读取。 */
export function readUserDataRootSettings(): UserDataRootSettings {
  const values = readRawSettings([CUSTOM_DATA_DIRECTORY_KEY, USER_DATA_ROOT_KEY])
  const read = (key: string): string | null => {
    const value = values.get(key)?.trim()
    return value ? value : null
  }
  return { customRoot: read(CUSTOM_DATA_DIRECTORY_KEY), persistedDefault: read(USER_DATA_ROOT_KEY) }
}

export function writePersistedDefaultUserDataRoot(value: string): void {
  writeRawSetting(USER_DATA_ROOT_KEY, value, 'json')
}
