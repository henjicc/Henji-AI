import { z } from 'zod'

/**
 * 智能助手技能（Skills）的唯一契约来源，渲染层与主进程共用。
 * 技能采用 Anthropic Agent Skills 标准结构：一个技能一个文件夹，含 `SKILL.md`
 * （YAML frontmatter + 正文），可选 `references/` 子目录承载二级渐进披露内容。
 *
 * 技能在本项目里只是"一段按需加载的提示词"，不携带工具授权、脚本或任何附加功效。
 */

export const ASSISTANT_SKILL_SCHEMA_VERSION = 'assistant-skill/v1' as const

/** `SKILL.md` 正文（不含 frontmatter）的字节上限。 */
export const ASSISTANT_SKILL_MAX_BODY_BYTES = 65_536
/** 内置与用户技能合并去重后的数量上限，超出部分被丢弃。 */
export const ASSISTANT_SKILL_MAX_COUNT = 100
export const ASSISTANT_SKILL_MAX_NAME_LENGTH = 64
export const ASSISTANT_SKILL_MAX_DESCRIPTION_LENGTH = 200
/** 单个技能可索引的引用文件数量上限，防止 `referencePaths` 撑爆能力输出。 */
export const ASSISTANT_SKILL_MAX_REFERENCE_COUNT = 64
/** `references/` 递归索引的最大深度。 */
export const ASSISTANT_SKILL_MAX_REFERENCE_DEPTH = 8

/** 单个技能允许落盘的文件数量上限。 */
export const ASSISTANT_SKILL_MAX_FILE_COUNT = 32
/** 单个技能允许落盘的总字节上限。 */
export const ASSISTANT_SKILL_MAX_TOTAL_BYTES = 1_048_576
/** 单个压缩包允许处理的条目数量上限，防止条目爆炸。 */
export const ASSISTANT_SKILL_MAX_ARCHIVE_ENTRIES = 512

/** 允许落盘与读取的纯文本扩展名，其余一律不安装、不索引、不读取。 */
export const ASSISTANT_SKILL_TEXT_EXTENSIONS = ['.md', '.txt'] as const
/** 允许作为安装来源的文件扩展名。 */
export const ASSISTANT_SKILL_SOURCE_EXTENSIONS = ['.md', '.zip'] as const
/** 压缩包内出现这些扩展名一律整包拒绝——嵌套归档等于绕过本层的所有校验。 */
export const ASSISTANT_SKILL_ARCHIVE_EXTENSIONS = [
  '.zip', '.gz', '.tar', '.tgz', '.rar', '.7z', '.bz2', '.xz',
] as const
export const ASSISTANT_SKILL_REFERENCE_DIR = 'references'
export const ASSISTANT_SKILL_ENTRY_FILE = 'SKILL.md'
/** 停用技能名单在 SQLite `settings` 表中的键名，值为 JSON 字符串数组。 */
export const ASSISTANT_SKILL_DISABLED_SETTING_KEY = 'assistant_disabled_skills'

/**
 * 技能名的字符规则。
 *
 * 刻意**不**沿用标准 Skills 的小写连字符格式：技能名同时是文件夹名、模型调用参数和界面上
 * 显示的标题，中文技能写中文名才是自然的。这里只是把允许集从 ASCII 扩到任意可打印字符，
 * 外部标准技能的 ASCII 名仍然合法，兼容性没有损失。
 *
 * 真正要拦的是"能改变路径含义"和"落不了盘"的字符，所以用显式黑名单。
 */

/**
 * 文件名非法字符：`< > : " /  | ? *` 加全部控制字符。
 * 用码点集合而不是正则字面量，是因为这些字符在正则里要么需要转义、要么根本不可打印，
 * 写成字面量既难读又容易在编辑中被改坏。
 */
const SKILL_NAME_FORBIDDEN_CODES = new Set([
  0x3c, 0x3e, 0x3a, 0x22, 0x2f, 0x5c, 0x7c, 0x3f, 0x2a,
])

function hasForbiddenSkillChar(segment: string): boolean {
  for (const character of segment) {
    const code = character.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return true
    // 空白会让模型传参出现歧义，中文名也用不上；trim 为空即是各类空白字符。
    if (character.trim() === '') return true
    if (SKILL_NAME_FORBIDDEN_CODES.has(code)) return true
  }
  return false
}

/** Windows 保留设备名，建同名文件夹会直接失败。 */
const WINDOWS_RESERVED_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 统一到 NFC：macOS 的文件名是 NFD，不归一化会让"同一个中文名"比不相等。 */
export function normalizeAssistantSkillName(name: string): string {
  return name.normalize('NFC')
}

function isSafeSkillSegment(segment: string): boolean {
  if (!segment || segment === '.' || segment === '..') return false
  if (segment.startsWith('.') || segment.endsWith('.')) return false
  if (hasForbiddenSkillChar(segment)) return false
  return !WINDOWS_RESERVED_NAME_PATTERN.test(segment.replace(/\.[^.]*$/, ''))
}

export const assistantSkillNameSchema = z.string()
  .min(1)
  .max(ASSISTANT_SKILL_MAX_NAME_LENGTH)
  .transform(normalizeAssistantSkillName)
  .refine(
    isSafeSkillSegment,
    '技能名不能包含空白、路径分隔符、控制字符或 < > : " | ? *，也不能以点开头或结尾'
  )

export const assistantSkillReferencePathSchema = z.string()
  .min(1)
  .max(256)
  .transform(normalizeAssistantSkillName)
  .refine((value) => {
    const segments = value.split('/')
    if (segments.length < 2 || segments[0] !== ASSISTANT_SKILL_REFERENCE_DIR) return false
    if (!segments.every(isSafeSkillSegment)) return false
    return /\.(?:md|txt)$/i.test(segments[segments.length - 1] ?? '')
  }, '引用路径必须位于 references/ 下、以 .md 或 .txt 结尾，且不含上级目录或非法字符')

export const assistantSkillSourceSchema = z.enum(['builtin', 'user'])

export const assistantSkillMetadataSchema = z.object({
  name: assistantSkillNameSchema,
  description: z.string().min(1).max(ASSISTANT_SKILL_MAX_DESCRIPTION_LENGTH),
  source: assistantSkillSourceSchema,
  overridesBuiltin: z.boolean(),
  enabled: z.boolean(),
  bodyBytes: z.number().int().nonnegative(),
  referencePaths: z.array(assistantSkillReferencePathSchema),
  updatedAt: z.string().datetime(),
}).strict()

export const assistantSkillDetailSchema = z.object({
  name: assistantSkillNameSchema,
  source: assistantSkillSourceSchema,
  /** `null` 表示 `SKILL.md` 正文，否则是 `references/` 下的引用文件相对路径。 */
  path: assistantSkillReferencePathSchema.nullable(),
  content: z.string(),
  bytes: z.number().int().nonnegative(),
}).strict()

export const assistantSkillInvalidEntrySchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
}).strict()

export const assistantSkillManifestSchema = z.object({
  schemaVersion: z.literal(ASSISTANT_SKILL_SCHEMA_VERSION),
  skills: z.array(assistantSkillMetadataSchema),
  invalid: z.array(assistantSkillInvalidEntrySchema),
}).strict()

export const assistantSkillInstallRequestSchema = z.object({
  sourcePath: z.string().min(1).max(4_096),
  /** 同名用户技能已存在时是否整体替换；缺省为 false，服务层返回 SKILL_ALREADY_EXISTS。 */
  overwrite: z.boolean().default(false),
}).strict()

export const assistantSkillSkippedFileSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
}).strict()

export const assistantSkillInstallResultSchema = z.object({
  installed: z.array(assistantSkillNameSchema),
  replaced: z.array(assistantSkillNameSchema),
  skippedFiles: z.array(assistantSkillSkippedFileSchema),
}).strict()

export const assistantSkillNameRequestSchema = z.object({
  name: assistantSkillNameSchema,
}).strict()

export const assistantSkillReadRequestSchema = z.object({
  name: assistantSkillNameSchema,
  path: assistantSkillReferencePathSchema.optional(),
}).strict()

export const assistantSkillEnabledUpdateSchema = z.object({
  name: assistantSkillNameSchema,
  enabled: z.boolean(),
}).strict()

export type AssistantSkillSource = z.infer<typeof assistantSkillSourceSchema>
export type AssistantSkillInstallRequest = z.infer<typeof assistantSkillInstallRequestSchema>
export type AssistantSkillSkippedFile = z.infer<typeof assistantSkillSkippedFileSchema>
export type AssistantSkillInstallResult = z.infer<typeof assistantSkillInstallResultSchema>
export type AssistantSkillReadRequest = z.infer<typeof assistantSkillReadRequestSchema>
export type AssistantSkillEnabledUpdate = z.infer<typeof assistantSkillEnabledUpdateSchema>
export type AssistantSkillMetadata = z.infer<typeof assistantSkillMetadataSchema>
export type AssistantSkillDetail = z.infer<typeof assistantSkillDetailSchema>
export type AssistantSkillInvalidEntry = z.infer<typeof assistantSkillInvalidEntrySchema>
export type AssistantSkillManifest = z.infer<typeof assistantSkillManifestSchema>

export const ASSISTANT_SKILL_ERROR_CODES = [
  'SKILL_NOT_FOUND',
  'SKILL_REFERENCE_NOT_FOUND',
  'SKILL_DISABLED',
  'SKILL_PATH_REJECTED',
  'SKILL_FRONTMATTER_INVALID',
  'SKILL_ALREADY_EXISTS',
  'SKILL_BUILTIN_READONLY',
  'UNSUPPORTED_SKILL_SOURCE',
  'SKILL_ARCHIVE_REJECTED',
  'SKILL_LIMIT_EXCEEDED',
] as const

export type AssistantSkillErrorCode = (typeof ASSISTANT_SKILL_ERROR_CODES)[number]

/** 技能链路的统一错误类型，带机器可读错误码；frontmatter 错误额外携带行号。 */
export class AssistantSkillError extends Error {
  readonly code: AssistantSkillErrorCode
  readonly line?: number

  constructor(
    code: AssistantSkillErrorCode,
    message: string,
    options?: { line?: number; cause?: unknown }
  ) {
    super(message)
    this.name = 'AssistantSkillError'
    this.code = code
    this.line = options?.line
    // 渲染层 tsconfig 的 target 早于 ES2022，Error 构造函数没有 options 形参，这里手动挂 cause。
    if (options?.cause !== undefined) Object.assign(this, { cause: options.cause })
  }
}

export function isAssistantSkillError(error: unknown): error is AssistantSkillError {
  return error instanceof AssistantSkillError
}

/** 判断文件名是否属于允许落盘的纯文本扩展名（大小写不敏感）。 */
export function isAssistantSkillTextFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  return ASSISTANT_SKILL_TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function createEmptyAssistantSkillManifest(): AssistantSkillManifest {
  return {
    schemaVersion: ASSISTANT_SKILL_SCHEMA_VERSION,
    skills: [],
    invalid: [],
  }
}
