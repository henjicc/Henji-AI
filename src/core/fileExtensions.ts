/*
 * 痕迹AI 自有文件后缀的唯一登记表（2026-10-24 用户确认统一命名）。
 *
 * 规则（`fileExtensions.test.ts` 自动检查，细则见 docs/rules/persistence.md「文件后缀」）：
 * - 格式固定为 `.hj` + 2～4 个小写字母，不用杠、数字或大写；
 * - 字母取常见英文缩写，一看就懂；
 * - 当前后缀与旧后缀全表不重复，也不与常见软件的后缀冲突；
 * - 新写出的文件一律用当前后缀；改后缀时把原后缀放进 legacyExtensions，只用于读取：
 *   扫描、打开、导入都认旧后缀（已发布的单文件包里就有旧后缀的文档），不主动把旧文件改名。
 *
 * 分三类：work 作品（能反复打开接着编辑）、exchange 交换包（发给别人、备份）、library 素材库（可复用）。
 * reserved 只占名，代码里还没有这种文件；正式启用时把 status 改成 active。
 */

export type HenjiFileCategory = 'work' | 'exchange' | 'library'

export interface HenjiFileType {
  /** 当前写出的后缀，含点。 */
  readonly extension: string
  /** 仍可读取的旧后缀，含点；按启用先后排列。 */
  readonly legacyExtensions: readonly string[]
  readonly category: HenjiFileCategory
  readonly label: string
  readonly status: 'active' | 'reserved'
}

export const HENJI_FILE_TYPES = {
  // 作品
  video_edit: { extension: '.hjvid', legacyExtensions: ['.henji-video'], category: 'work', label: '剪辑', status: 'active' },
  audio_edit: { extension: '.hjaud', legacyExtensions: ['.henji-audio'], category: 'work', label: '口播', status: 'active' },
  image_document: { extension: '.hjimg', legacyExtensions: ['.henjiimg'], category: 'work', label: '图片文档', status: 'active' },
  canvas: { extension: '.hjcvs', legacyExtensions: ['.henji-canvas'], category: 'work', label: '画布', status: 'active' },
  camera_stage: { extension: '.hjstg', legacyExtensions: ['.henji-stage'], category: 'work', label: '镜头参考', status: 'active' },
  screen_recording: { extension: '.hjrec', legacyExtensions: ['.henji-recording'], category: 'work', label: '屏幕录制', status: 'active' },
  web_recording: { extension: '.hjweb', legacyExtensions: [], category: 'work', label: '网页录制', status: 'active' },
  model_scene: { extension: '.hjmdl', legacyExtensions: [], category: 'work', label: '三维场景', status: 'reserved' },
  subtitle: { extension: '.hjsub', legacyExtensions: [], category: 'work', label: '字幕稿', status: 'reserved' },
  storyboard: { extension: '.hjsbd', legacyExtensions: [], category: 'work', label: '分镜脚本', status: 'reserved' },
  project: { extension: '.hjprj', legacyExtensions: [], category: 'work', label: '项目入口', status: 'reserved' },
  // 交换包
  document_package: { extension: '.hjpak', legacyExtensions: ['.henjipack'], category: 'exchange', label: '项目与文档包', status: 'active' },
  // 素材库
  style_package: { extension: '.hjsty', legacyExtensions: ['.henjistyle'], category: 'library', label: '风格包', status: 'active' },
  preset_package: { extension: '.hjpre', legacyExtensions: ['.henjipreset'], category: 'library', label: '剪辑预设', status: 'active' },
  canvas_layer_package: { extension: '.hjlyr', legacyExtensions: ['.henjilayer'], category: 'library', label: '图层包', status: 'active' },
  template_package: { extension: '.hjtpl', legacyExtensions: [], category: 'library', label: '模板', status: 'reserved' },
  code_effect: { extension: '.hjfx', legacyExtensions: [], category: 'library', label: '代码效果', status: 'reserved' },
} as const satisfies Record<string, HenjiFileType>

export type HenjiFileTypeId = keyof typeof HENJI_FILE_TYPES

/** 当前后缀（含点），如 `.hjvid`。 */
export function henjiExtension(id: HenjiFileTypeId): string {
  return HENJI_FILE_TYPES[id].extension
}

/** 仍可读取的旧后缀（含点）。 */
export function henjiLegacyExtensions(id: HenjiFileTypeId): readonly string[] {
  return HENJI_FILE_TYPES[id].legacyExtensions
}

/** 当前后缀在前、旧后缀在后（含点）；用于打开对话框的过滤与识别。 */
export function henjiReadableExtensions(id: HenjiFileTypeId): readonly string[] {
  return [HENJI_FILE_TYPES[id].extension, ...HENJI_FILE_TYPES[id].legacyExtensions]
}

/** 同上，但不带点，直接给系统文件对话框的 filters 用。 */
export function henjiDialogExtensions(id: HenjiFileTypeId): string[] {
  return henjiReadableExtensions(id).map((extension) => extension.slice(1))
}

/** 文件名以该类型任一可读后缀结尾（不分大小写）时返回匹配到的后缀，否则 null。 */
export function matchHenjiExtension(id: HenjiFileTypeId, fileName: string): string | null {
  const lower = fileName.toLowerCase()
  return henjiReadableExtensions(id).find((extension) => lower.length > extension.length && lower.endsWith(extension)) ?? null
}

/** 文件用的是旧后缀（还能读，但新写出时应换成当前后缀）。 */
export function usesLegacyHenjiExtension(id: HenjiFileTypeId, fileName: string): boolean {
  const matched = matchHenjiExtension(id, fileName)
  return matched !== null && matched !== HENJI_FILE_TYPES[id].extension
}

/** 去掉该类型的可读后缀得到名称；不匹配时返回 null。 */
export function stripHenjiExtension(id: HenjiFileTypeId, fileName: string): string | null {
  const matched = matchHenjiExtension(id, fileName)
  return matched === null ? null : fileName.slice(0, -matched.length)
}
