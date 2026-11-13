/**
 * 识别文件中的文字：本地内置 PP-OCR 只认图片，DeepSeek OCR 认 PDF、Word、PowerPoint 与图片。
 * auto 时图片优先本地（免费、不出本机），文档只能走 DeepSeek。渲染层估价与主进程执行共用这一份判定。
 */
export type DocumentTextEngine = 'local' | 'deepseek'
export type DocumentTextEngineChoice = 'auto' | DocumentTextEngine

// 应用内置的图片解码不支持 BMP，BMP 只能交给 DeepSeek。
const LOCAL_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff'])
const DEEPSEEK_IMAGE_EXTENSIONS = new Set([...LOCAL_IMAGE_EXTENSIONS, 'bmp'])
const DEEPSEEK_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'ppt', 'pptx'])
/** DeepSeek OCR 单文件上限。 */
export const DOCUMENT_TEXT_MAX_BYTES = 100 * 1024 * 1024

export const DOCUMENT_TEXT_MEDIA_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function documentTextExtension(path: string): string {
  const name = path.split(/[\\/]/).at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export class DocumentTextEngineError extends Error {}

export function resolveDocumentTextEngine(path: string, choice: DocumentTextEngineChoice): DocumentTextEngine {
  const extension = documentTextExtension(path)
  const image = LOCAL_IMAGE_EXTENSIONS.has(extension)
  if (!DEEPSEEK_IMAGE_EXTENSIONS.has(extension) && !DEEPSEEK_DOCUMENT_EXTENSIONS.has(extension)) {
    throw new DocumentTextEngineError('DOCUMENT_FORMAT_UNSUPPORTED: 只支持 PDF、Word（doc/docx）、PowerPoint（ppt/pptx）与 PNG、JPEG、WebP、GIF、BMP、TIFF 图片。')
  }
  if (choice === 'local' && !image) {
    throw new DocumentTextEngineError('LOCAL_OCR_IMAGE_ONLY: 本地文字识别只支持 PNG、JPEG、WebP、GIF、TIFF 图片；PDF、Word、PowerPoint 与 BMP 请改用 engine="deepseek"。')
  }
  return choice === 'auto' ? image ? 'local' : 'deepseek' : choice
}

/** DeepSeek OCR 1.5 元/千页；文档页数要识别后才知道，按官方单份上限 1000 页估上限，图片按 1 页。 */
export function documentTextEstimatedCny(path: string, engine: DocumentTextEngine): number {
  if (engine === 'local') return 0
  return DEEPSEEK_IMAGE_EXTENSIONS.has(documentTextExtension(path)) ? 0.0015 : 1.5
}
