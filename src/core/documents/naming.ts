import type { EntryNameInvalidReason, FolderLocale } from './types'

/*
 * 项目与文档的名称规则（实施方案 2.8 同名检测，重要记录 015）。
 *
 * 项目名就是文件夹名，文档名就是文件名（不含扩展名），因此统一按 Windows 文件名规则判断，
 * 在任何平台上都一样，项目拷给 Windows 用户也能打开：
 * - 去掉首尾空白与末尾的点（Windows 会静默去掉它们，不去掉会出现“看起来不同、实际同名”）。
 * - 拒绝 \ / : * ? " < > | 与控制字符；拒绝 CON、PRN、AUX、NUL、COM1–9、LPT1–9 等保留名（带扩展名也算）。
 * - 比较不分大小写并做 Unicode NFC 归一。
 *
 * 只在同一个文件夹里查重；用户输入的名字重名时由调用方提示，不偷偷加后缀。
 * 自动名（未命名项目 N）与“两个都保留”的序号由这里的函数生成。
 */

export const MAX_ENTRY_NAME_LENGTH = 120

// eslint-disable-next-line no-control-regex
const ILLEGAL_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i

export type EntryNameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: EntryNameInvalidReason; message: string }

const INVALID_MESSAGES: Record<EntryNameInvalidReason, string> = {
  empty: '请输入名称。',
  too_long: `名称最多 ${MAX_ENTRY_NAME_LENGTH} 个字符。`,
  illegal_characters: '名称不能包含 \\ / : * ? " < > | 等字符。',
  reserved: '这个名称不能用作文件名，请换一个。',
}

/** 去掉首尾空白与末尾的点。 */
export function trimEntryName(input: string): string {
  return input.trim().replace(/[.\s]+$/u, '').trim()
}

/** 规范化并校验名称；返回去掉首尾空白与末尾点之后的名称。 */
export function normalizeEntryName(input: string): EntryNameCheck {
  const name = trimEntryName(input)
  const fail = (reason: EntryNameInvalidReason): EntryNameCheck => ({ ok: false, reason, message: INVALID_MESSAGES[reason] })
  if (!name) return fail('empty')
  if (ILLEGAL_CHARACTERS.test(name)) return fail('illegal_characters')
  if (RESERVED_NAME.test(name)) return fail('reserved')
  if (name.length > MAX_ENTRY_NAME_LENGTH) return fail('too_long')
  return { ok: true, name }
}

/** 名称比较键：不分大小写、NFC 归一、忽略首尾空白与末尾的点。 */
export function entryNameKey(name: string): string {
  return trimEntryName(name).normalize('NFC').toLowerCase()
}

export function sameEntryName(left: string, right: string): boolean {
  return entryNameKey(left) === entryNameKey(right)
}

/** 文件名：名称 + 扩展名（扩展名含点）。 */
export function documentFileName(name: string, extension: string): string {
  return `${name}${extension}`
}

/** 文件名的扩展名与给定扩展名一致（不分大小写）时返回名称部分，否则 null。 */
export function documentNameFromFileName(fileName: string, extension: string): string | null {
  if (fileName.length <= extension.length) return null
  if (fileName.slice(-extension.length).toLowerCase() !== extension.toLowerCase()) return null
  return fileName.slice(0, -extension.length)
}

/** 自动名：“未命名项目 1/2/3…”，取第一个没被占用的。 */
export function untitledEntryName(base: string, isTaken: (name: string) => boolean, start = 1): string {
  for (let index = Math.max(1, start); index < 100_000; index += 1) {
    const name = `${base} ${index}`
    if (!isTaken(name)) return name
  }
  throw new Error('同名的自动名称过多，请先整理文件夹。')
}

/** “两个都保留”：名称、名称 (2)、名称 (3)…，取第一个没被占用的；超长时截短名称部分。 */
export function keepBothEntryName(name: string, isTaken: (name: string) => boolean): string {
  if (!isTaken(name)) return name
  for (let index = 2; index < 100_000; index += 1) {
    const suffix = ` (${index})`
    const stem = name.length + suffix.length > MAX_ENTRY_NAME_LENGTH
      ? name.slice(0, MAX_ENTRY_NAME_LENGTH - suffix.length).trimEnd()
      : name
    const candidate = `${stem}${suffix}`
    if (!isTaken(candidate)) return candidate
  }
  throw new Error('同名文件过多，请先整理文件夹。')
}

/** 按语言取自动名前缀等成对名称。 */
export type LocalizedNames = Readonly<Record<FolderLocale, string>>
