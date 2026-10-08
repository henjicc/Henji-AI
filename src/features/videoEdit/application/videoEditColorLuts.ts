import { createLogger } from '@/core/logging'
import { CUBE_LUT_MAX_BYTES, type CubeLut } from '@/core/videoEdit/cubeLut'
import type { ColorLutAsset } from '@/core/videoEdit/colorLutAsset'
import { getPlatform } from '@/platform/runtime'
import { sameVideoEditMediaPath } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance } from './videoEditService'
import { decodeVideoEditLutOffThread } from './videoEditColorLutClient'
const logger = createLogger('features.videoEdit.colorLuts')
async function read(path: string, signal?: AbortSignal): Promise<{ lut: CubeLut; contentIdentity: string }> {
  signal?.throwIfAborted()
  const bytes = await getPlatform().system.fs.readFile(path, { maxBytes: CUBE_LUT_MAX_BYTES })
  signal?.throwIfAborted()
  const result = await decodeVideoEditLutOffThread(bytes, signal); signal?.throwIfAborted()
  return result
}
/** Project-local source reference; existing dialog grants file access and document paths own relocation/collection. */
export async function importVideoEditColorLut(projectId: string, signal?: AbortSignal): Promise<ColorLutAsset | null> {
  const owner = requireVideoEditInstance(projectId); const snapshot = owner.document
  logger.info('LUT 导入开始', { event: 'video_edit.color_grade.lut.import.start', context: { projectId } })
  try {
    const selected = await getPlatform().system.dialog.open({ multiple: false, filters: [{ name: '颜色查找表', extensions: ['cube'] }] })
    signal?.throwIfAborted(); const path = Array.isArray(selected) ? selected[0] : selected
    if (!path) return null
    const { contentIdentity } = await read(path, signal)
    if (requireVideoEditInstance(projectId) !== owner || owner.document !== snapshot) throw new Error('剪辑已改变，请重新导入 LUT。')
    const previous = snapshot.colorLuts?.find(value => sameVideoEditMediaPath(value.path, path) && value.contentIdentity === contentIdentity)
    if (previous) return previous
    const asset: ColorLutAsset = { id: crypto.randomUUID(), name: path.split(/[\\/]/).at(-1) ?? 'LUT', path, contentIdentity }
    editVideoProject(projectId, document => ({ ...document, colorLuts: [...(document.colorLuts ?? []), asset] }))
    logger.info('LUT 已导入项目', { event: 'video_edit.color_grade.lut.import.completed', context: { projectId, lutId: asset.id } })
    return asset
  } catch (error) { logger.warn('LUT 导入失败', { event: 'video_edit.color_grade.lut.import.failed', error, context: { projectId } }); throw error }
}
/** No stale success cache: verify bytes on every resource activation. GPU cache uses the verified digest. */
export async function readVideoEditColorLut(asset: ColorLutAsset): Promise<CubeLut> {
  try {
    const result = await read(asset.path)
    if (result.contentIdentity !== asset.contentIdentity) throw new Error('LUT 文件已改变，请重新导入原文件。')
    return result.lut
  } catch (error) { logger.warn('LUT 读取失败', { event: 'video_edit.color_grade.lut.read.failed', error, context: { lutId: asset.id } }); throw new Error(`无法使用“${asset.name}”，请恢复或重新导入 LUT。`, { cause: error }) }
}
