import {
  ASSISTANT_SKILL_DISABLED_SETTING_KEY,
  assistantSkillNameSchema,
} from '../../../../../src/core/assistant/skills'
import { getDb } from '../../db'
import { createMainLogger } from '../../logging'

const logger = createMainLogger('main.assistant_skills')

interface SettingValueRow {
  value: string
}

/**
 * 读取被用户停用的技能名单（SQLite `settings` 表的 `assistant_disabled_skills` 键，
 * 值为 JSON 字符串数组）。缺失或损坏都视为"全部启用"——技能默认启用是安全的默认值，
 * 不该因为一行设置读不出来就让助手失去全部领域知识。写入侧在任务 2.1 实现。
 */
export function readDisabledSkillNames(): string[] {
  let raw: string | undefined
  try {
    const row = getDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(ASSISTANT_SKILL_DISABLED_SETTING_KEY) as SettingValueRow | undefined
    raw = row?.value?.trim()
  } catch (error) {
    logger.warn('读取技能停用名单失败，按全部启用处理', {
      event: 'assistant_skill.disabled_list.read_failed',
      error,
    })
    return []
  }

  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch (error) {
    logger.warn('技能停用名单不是合法 JSON，按全部启用处理', {
      event: 'assistant_skill.disabled_list.parse_failed',
      error,
    })
    return []
  }
}

/**
 * 写入技能启停状态。
 *
 * **内置与用户技能在这里一视同仁，不做来源限制。** 停用内置技能时的二次确认是界面层的事，
 * 不能当作权限校验放在这里——否则以后从别的入口调这个函数会被莫名其妙地拒绝。
 */
export function setAssistantSkillEnabled(name: string, enabled: boolean): string[] {
  const skillName = assistantSkillNameSchema.parse(name)
  const current = new Set(readDisabledSkillNames())
  if (enabled) {
    current.delete(skillName)
  } else {
    current.add(skillName)
  }
  const next = Array.from(current).sort((left, right) => left.localeCompare(right))
  getDb()
    .prepare(`
      INSERT INTO settings(key, value, type, updated_at)
      VALUES (?, ?, 'json', CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `)
    .run(ASSISTANT_SKILL_DISABLED_SETTING_KEY, JSON.stringify(next))
  logger.info('更新技能启停状态完成', {
    event: 'assistant_skill.set_enabled.completed',
    context: { skill: skillName, enabled, disabledCount: next.length },
  })
  return next
}
