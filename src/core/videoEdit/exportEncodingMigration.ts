import { videoEditExportLevels } from './exportEncoding'

type Json = Record<string, unknown>
const object = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 目标码率迁到唯一字段；保留历史压制方式，HEVC 不存在的级别由编码器自动选择。 */
function migrateSettings(value: unknown): unknown {
  if (!object(value) || !object(value.encoding)) return value
  const { bitrateMbps, ...encoding } = value.encoding
  if (value.codec === 'hevc' && typeof encoding.level === 'string' && !videoEditExportLevels('hevc').includes(encoding.level)) encoding.level = 'auto'
  if (typeof encoding.encoder === 'string' && encoding.encoder.endsWith('_nvenc') && encoding.quality === 0) encoding.quality = 1
  return { ...value, ...(typeof bitrateMbps === 'number' ? { videoBitrateMbps: bitrateMbps } : {}), encoding }
}

/** 初版导出记忆保留实际压制码率，缺失的可选字段不补入。 */
export function migrateVideoEditExportEntries(value: unknown): unknown {
  return Array.isArray(value) ? value.map(entry => object(entry) ? { ...entry, settings: migrateSettings(entry.settings) } : entry) : value
}
