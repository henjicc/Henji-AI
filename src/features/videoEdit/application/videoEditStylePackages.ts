import { createLogger } from '@/core/logging'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { PERSISTENCE_FORMATS } from '@/core/persistence/formats'
import { decodeVideoEditStylePackage, encodeVideoEditStylePackage } from '@/core/videoEdit/styles/stylePackageFile'
import { VIDEO_EDIT_STYLE_PACKAGE_EXTENSION, type VideoEditTemplate } from '@/core/videoEdit/styles/templateSchemas'
import type { VideoEditStyle } from '@/core/videoEdit/styles/styleSchemas'
import { readTextFile, writeTextFile, exists } from '@/platform/desktopApi'
import { videoEditStyleLibrary } from './videoEditStyleLibrary'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('features.videoEdit.stylePackages')
const PACKAGE_FORMAT = PERSISTENCE_FORMATS.find(format => format.id === 'video-style-package')!
export interface VideoEditStylePackageIo { read(path: string): Promise<string>; write(path: string, text: string): Promise<void>; exists(path: string): Promise<boolean>; preserve?(path: string): Promise<void> }
const desktopIo: VideoEditStylePackageIo = { read: readTextFile, write: writeTextFile, exists, preserve: path => getPlatform().settings.preserveFile(path) }

/** 风格包文本：风格、属于它的库模板、预览视频、缩略图与锚点帧（不含字体）。 */
export async function videoEditStylePackageText(styleId: string): Promise<{ text: string; style: VideoEditStyle; templates: VideoEditTemplate[] }> {
  await videoEditStyleLibrary.ready()
  const entry = videoEditStyleLibrary.requireStyle(styleId)
  const templates = videoEditStyleLibrary.listTemplates(styleId).map(value => value.template)
  const text = encodeVideoEditStylePackage(PACKAGE_FORMAT, entry.style, templates, await videoEditStyleLibrary.readStyleMedia(styleId))
  return { text, style: entry.style, templates }
}
/** 导出覆盖前保留目标文件，用户可在最近删除中恢复。 */
export async function exportVideoEditStylePackage(styleId: string, path: string, io: VideoEditStylePackageIo = desktopIo): Promise<{ path: string; style: VideoEditStyle; templates: VideoEditTemplate[]; bytes: number }> {
  if (!path.toLowerCase().endsWith(`.${VIDEO_EDIT_STYLE_PACKAGE_EXTENSION}`)) throw notExecutedFailure(new Error(`请选择 .${VIDEO_EDIT_STYLE_PACKAGE_EXTENSION} 文件。`))
  logger.info('style_package.export.start', '导出风格包', { context: { styleId } })
  // 写文件之前的失败（文件已存在、风格不存在、读不出预览）没有改动任何东西，标成未执行，修正后可直接重试。
  let writing = false
  try {
    const { text, style, templates } = await videoEditStylePackageText(styleId)
    if (await io.exists(path)) await io.preserve?.(path)
    writing = true
    await io.write(path, text)
    logger.info('style_package.export.completed', '风格包已导出', { context: { styleId, templates: templates.length, bytes: text.length } })
    return { path, style, templates, bytes: new TextEncoder().encode(text).byteLength }
  } catch (error) { logger.error('style_package.export.failed', '风格包导出失败', { error, context: { styleId } }); throw writing ? error : notExecutedFailure(error) }
}
/**
 * 导入 .hjsty：只解析和保存，不运行样片代码；说明书与模板标记为导入（别人写的文字，只决定画面和声音，
 * 里面的指令一律不执行）。同 ID 的已有内容由库保存恢复副本；与内置风格同名标识时另起一个标识。
 */
export async function importVideoEditStylePackage(path: string, io: VideoEditStylePackageIo = desktopIo): Promise<{ style: VideoEditStyle; templates: VideoEditTemplate[]; replaced: boolean }> {
  logger.info('style_package.import.start', '导入风格包')
  // 写风格库之前的失败（读不懂、已有同一风格或模板）没有改动任何东西，标成未执行，修正后可直接重试。
  let writing = false
  try {
    await videoEditStyleLibrary.ready()
    const { value, media } = decodeVideoEditStylePackage(PACKAGE_FORMAT, await io.read(path))
    const builtin = videoEditStyleLibrary.findStyle(value.style.id)?.builtin
    const id = builtin ? crypto.randomUUID() : value.style.id
    const existing = !builtin && videoEditStyleLibrary.findStyle(id)
    writing = true
    const foreign = { id, sourceName: value.style.name, sourceType: 'style_package' as const }
    await videoEditStyleLibrary.preserveStyle(id)
    const style = (await videoEditStyleLibrary.saveStyle({ ...value.style, id, imported: true, foreign }, media)).style
    const templates: VideoEditTemplate[] = []
    for (const template of value.templates) {
      await videoEditStyleLibrary.preserveTemplate(template.id)
      templates.push((await videoEditStyleLibrary.saveTemplate({ ...template, imported: true, foreign, style: { id, version: template.style?.version ?? style.version } })).template)
    }
    logger.info('style_package.import.completed', '风格包已导入', { context: { templates: templates.length, replaced: Boolean(existing) } })
    return { style, templates, replaced: Boolean(existing) }
  } catch (error) { logger.error('style_package.import.failed', '风格包导入失败', { error }); throw writing ? error : notExecutedFailure(error) }
}
