import type { GenerationHistoryPlatform, PresetsPlatform, SettingsPlatform } from '../../src/platform/contracts/localRecords'

/** 生成记录、预设、设置（存储底座 2.3），接口与 PAL 同名平台接口相同。 */
export type HenjiGenerationHistoryApi = GenerationHistoryPlatform
export type HenjiPresetsApi = PresetsPlatform
export type HenjiSettingsApi = SettingsPlatform
