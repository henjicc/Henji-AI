import {
  ASSISTANT_SKILL_MAX_DESCRIPTION_LENGTH,
  ASSISTANT_SKILL_MAX_NAME_LENGTH,
  AssistantSkillError,
  assistantSkillNameSchema,
} from '../../../../../src/core/assistant/skills'

/**
 * `SKILL.md` 的 frontmatter 解析器。
 *
 * 依赖中没有 YAML 库，也刻意不引入：完整 YAML 的锚点、别名与隐式类型转换是纯粹的额外
 * 攻击面，而技能只需要两个标量字段。解析规则分两档：
 *
 * - `name` / `description` 严格解析，必须是单行 `key: value` 标量，任何异常都带行号报出。
 * - 其余任何键宽容跳过——标量、列表、缩进块都识别边界后整段丢弃，**永不解释、永不返回**。
 *   这样外部标准技能带着 `allowed-tools`、`license`、`metadata` 也能装上，但在本项目里
 *   不产生任何效果。
 */

export interface ParsedSkillFrontmatter {
  name: string
  description: string
  /** 去掉 frontmatter 之后的正文。 */
  body: string
}

const KEY_LINE_PATTERN = /^([A-Za-z0-9_.-]+)\s*:(.*)$/
const BLOCK_SCALAR_PATTERN = /^[>|][-+]?\d*$/
const FRONTMATTER_DELIMITER = '---'
const LEADING_BOM = '﻿'

function stripLeadingBom(source: string): string {
  return source.startsWith(LEADING_BOM) ? source.slice(LEADING_BOM.length) : source
}

function invalid(line: number, message: string): AssistantSkillError {
  return new AssistantSkillError('SKILL_FRONTMATTER_INVALID', `第 ${line} 行：${message}`, { line })
}

function readScalarValue(raw: string, key: string, line: number): string {
  const value = raw.trim()
  if (!value) {
    throw invalid(line, `${key} 的值不能为空`)
  }
  if (BLOCK_SCALAR_PATTERN.test(value)) {
    throw invalid(line, `${key} 不支持折叠或块标量写法，必须写成单行 ${key}: 值`)
  }
  if (value.startsWith('[') || value.startsWith('{')) {
    throw invalid(line, `${key} 不支持列表或映射写法，必须是单行文本`)
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim()
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'").trim()
  }
  return value
}

function validateName(name: string, line: number): string {
  if (name.length > ASSISTANT_SKILL_MAX_NAME_LENGTH) {
    throw invalid(line, `name 超过 ${ASSISTANT_SKILL_MAX_NAME_LENGTH} 个字符（当前 ${name.length}）`)
  }
  const parsed = assistantSkillNameSchema.safeParse(name)
  if (!parsed.success) {
    throw invalid(
      line,
      'name 会直接作为技能文件夹名，不能包含空白、路径分隔符或 < > : " | ? *，也不能以点开头或结尾。中文名可以直接写，例如 图片生成'
    )
  }
  // schema 顺带做了 NFC 归一化，这里取归一化后的值，保证与文件夹名比较时不会因为
  // macOS 的 NFD 形式而"看起来一样却不相等"。
  return parsed.data
}

function validateDescription(description: string, line: number): string {
  if (description.length > ASSISTANT_SKILL_MAX_DESCRIPTION_LENGTH) {
    throw invalid(
      line,
      `description 超过 ${ASSISTANT_SKILL_MAX_DESCRIPTION_LENGTH} 个字符（当前 ${description.length}）`
    )
  }
  return description
}

export function parseSkillFrontmatter(source: string): ParsedSkillFrontmatter {
  const lines = stripLeadingBom(source).replace(/\r\n?/g, '\n').split('\n')
  if ((lines[0] ?? '').trim() !== FRONTMATTER_DELIMITER) {
    throw invalid(1, 'SKILL.md 必须以 --- 开头的 frontmatter，其中声明 name 与 description')
  }

  let closingIndex = -1
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? '').trim() === FRONTMATTER_DELIMITER) {
      closingIndex = index
      break
    }
  }
  if (closingIndex < 0) {
    throw invalid(lines.length, 'frontmatter 缺少结束的 ---')
  }

  let name: string | null = null
  let description: string | null = null
  let skippingUnknownKey = false

  for (let index = 1; index < closingIndex; index += 1) {
    const raw = lines[index] ?? ''
    const line = index + 1
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const indented = raw.length !== raw.trimStart().length
    const listItem = trimmed === '-' || trimmed.startsWith('- ')
    if (indented || listItem) {
      // 未知键的列表项与缩进块整段丢弃；name / description 之后出现缩进即为非法写法。
      if (skippingUnknownKey) continue
      throw invalid(line, 'name 与 description 必须写成单行 key: 值，不支持缩进块或列表')
    }

    const match = KEY_LINE_PATTERN.exec(trimmed)
    if (!match) {
      throw invalid(line, '无法解析的 frontmatter 行，应为 key: 值')
    }

    const key = (match[1] ?? '').toLowerCase()
    if (key !== 'name' && key !== 'description') {
      skippingUnknownKey = true
      continue
    }
    skippingUnknownKey = false

    const value = readScalarValue(match[2] ?? '', key, line)
    if (key === 'name') {
      if (name !== null) {
        throw invalid(line, 'name 重复声明')
      }
      name = validateName(value, line)
    } else {
      if (description !== null) {
        throw invalid(line, 'description 重复声明')
      }
      description = validateDescription(value, line)
    }
  }

  if (name === null) {
    throw invalid(closingIndex + 1, 'frontmatter 缺少 name')
  }
  if (description === null) {
    throw invalid(closingIndex + 1, 'frontmatter 缺少 description')
  }

  const body = lines.slice(closingIndex + 1).join('\n').replace(/^\n+/, '').trimEnd()
  return { name, description, body }
}
