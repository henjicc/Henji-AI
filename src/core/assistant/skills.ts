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

/** 允许落盘与读取的纯文本扩展名，其余一律不安装、不索引、不读取。 */
export const ASSISTANT_SKILL_TEXT_EXTENSIONS = ['.md', '.txt'] as const
export const ASSISTANT_SKILL_REFERENCE_DIR = 'references'
export const ASSISTANT_SKILL_ENTRY_FILE = 'SKILL.md'
/** 停用技能名单在 SQLite `settings` 表中的键名，值为 JSON 字符串数组。 */
export const ASSISTANT_SKILL_DISABLED_SETTING_KEY = 'assistant_disabled_skills'

export const assistantSkillNameSchema = z.string()
  .min(1)
  .max(ASSISTANT_SKILL_MAX_NAME_LENGTH)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, '技能名只能包含小写字母、数字和单个连字符')

export const assistantSkillReferencePathSchema = z.string()
  .min(1)
  .max(256)
  .regex(
    /^references\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\.(md|txt)$/,
    '引用路径必须位于 references/ 下且以 .md 或 .txt 结尾'
  )
  .refine((value) => !value.split('/').includes('..'), '引用路径不能包含上级目录')

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

export type AssistantSkillSource = z.infer<typeof assistantSkillSourceSchema>
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
