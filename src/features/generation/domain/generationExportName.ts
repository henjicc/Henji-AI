import { entryNameKey, keepBothEntryName } from '@/core/documents/naming'

// eslint-disable-next-line no-control-regex
const ILLEGAL_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]+/gu
const PROMPT_GRAPHEMES = 16
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export interface GenerationExportNameInput {
  createdAt: Date
  modelName: string
  prompt: string | null
  /** 这条记录的第几个结果（从 0 起）；只有一个结果时不写序号。 */
  outputIndex: number
  outputCount: number
}

function cleanSegment(text: string): string {
  return text.replace(ILLEGAL_FILE_NAME_CHARACTERS, ' ').replace(/\s+/gu, ' ').trim().replace(/[.\s]+$/u, '')
}

export function formatLocalDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 导出文件名（不含扩展名）：日期_模型_提示词开头_序号。
 * 生成目录里的原文件名是随机串，导出给人看、发给别人时要一眼认出是哪次生成；按日期开头，文件夹里按名称排就是时间顺序。
 */
export function generationExportBaseName(input: GenerationExportNameInput): string {
  const prompt = [...graphemes.segment(cleanSegment(input.prompt ?? ''))].slice(0, PROMPT_GRAPHEMES).map(({ segment }) => segment).join('').trim()
  const parts = [formatLocalDate(input.createdAt), cleanSegment(input.modelName), prompt].filter(Boolean)
  if (input.outputCount > 1) parts.push(String(input.outputIndex + 1))
  return parts.join('_')
}

/** 同一批里与目标位置已有的文件重名时，按“名称 (2)”顺延，不覆盖任何已有文件。 */
export function createExportNameAllocator(existingFileNames: Iterable<string>): (baseName: string, extension: string) => string {
  const taken = new Set([...existingFileNames].map(entryNameKey))
  return (baseName, extension) => {
    const suffix = extension ? `.${extension}` : ''
    const stem = keepBothEntryName(baseName, (candidate) => taken.has(entryNameKey(`${candidate}${suffix}`)))
    const fileName = `${stem}${suffix}`
    taken.add(entryNameKey(fileName))
    return fileName
  }
}
