import { getPlatform } from '@/platform'
import type { SettingValueType } from '@/platform/contracts/localRecords'

export async function getAppSetting(key: string): Promise<string | null> {
  return (await getPlatform().settings.get(key))?.value ?? null
}

export async function setAppSetting(key: string, value: string, type: SettingValueType = 'string'): Promise<void> {
  await getPlatform().settings.set(key, value, type)
}

export async function deleteAppSetting(key: string): Promise<void> {
  await getPlatform().settings.delete(key)
}
