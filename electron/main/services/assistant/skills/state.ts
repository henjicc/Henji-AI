import { ASSISTANT_SKILL_DISABLED_SETTING_KEY } from '../../../../../src/core/assistant/skills'
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
