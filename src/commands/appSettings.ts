import { getPlatform } from '@/platform'
import type { SettingEntryDto, SettingValueType } from '@/platform/contracts/localRecords'

/**
 * 程序目录数据库里的设置项（存储底座 2.3）：表归主进程仓库，渲染层只经这里访问。
 * 值里的文件位置由主进程换算，这里读写的始终是绝对路径。
 */

export async function getAppSettingEntry(key: string): Promise<SettingEntryDto | null> {
  return await getPlatform().settings.get(key)
}

export async function getAppSetting(key: string): Promise<string | null> {
  return (await getPlatform().settings.get(key))?.value ?? null
}

export async function setAppSetting(key: string, value: string, type: SettingValueType = 'string'): Promise<void> {
  await getPlatform().settings.set(key, value, type)
}

export async function deleteAppSetting(key: string): Promise<void> {
  await getPlatform().settings.delete(key)
}
