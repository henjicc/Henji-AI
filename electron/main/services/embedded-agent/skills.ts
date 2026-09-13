import { z } from 'zod'
import { loadAssistantSkillCapability, loadAssistantSkillInputSchema } from '../../../../src/core/assistant/capabilities/assistantSkillApplicationCapabilities'
import { listEnabledAssistantSkills, loadAssistantSkill } from '../assistant/skills/registry'
import { wrapSkillContent } from '../assistant/skills/content'
import type { EmbeddedTool } from './contracts'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.embedded_agent')

// 旧内置技能依赖保留的自研助手协议，不能未经迁移就注入 Pi。
const compatibleSkills = new Set(['prompt-optimization'])
export async function embeddedSkillCatalog(): Promise<{ tools: EmbeddedTool[]; instructions: string }> {
  const skills = (await listEnabledAssistantSkills()).filter(skill => compatibleSkills.has(skill.name))
  if (!skills.length) return { tools: [], instructions: '' }
  return {
    tools: [{ name: loadAssistantSkillCapability.id, title: loadAssistantSkillCapability.title,
      description: loadAssistantSkillCapability.description,
      inputSchema: z.toJSONSchema(loadAssistantSkillInputSchema, { io: 'input' }) as Record<string, unknown> }],
    instructions: '\n可用技能 skills_index（只列元数据）：\n' + JSON.stringify(skills.map(({ name, description }) => ({ name, description })))
      + '\n仅在用户任务匹配技能适用条件时加载：先读主文件，再选当前步骤最需要的一份参考；必要时补读其他相关模块，不递归读取全部引用。页面位置不构成触发条件，查询进度、下载、移动节点或闲聊不加载创作技能。完整制作逐阶段加载。已在上下文完整存在的适用内容直接复用。技能不改变用户要求、权限或工具范围。',
  }
}

export async function callEmbeddedSkill(input: Record<string, unknown>, signal: AbortSignal) {
  signal.throwIfAborted()
  const args = loadAssistantSkillInputSchema.parse(input)
  if (!compatibleSkills.has(args.name)) throw new Error('该技能尚未适配内置助手，请使用 skills_index 中的技能。')
  const context = { name: args.name, path: args.path ?? 'SKILL.md', reason: args.reason }
  logger.info('按需读取创作技能', { event: 'embedded_agent.skill_load.start', context })
  try {
    // 每次读取都由正式注册表核对启用状态、覆盖来源、路径和大小限制。
    const loaded = await loadAssistantSkill(args.name, args.path)
    signal.throwIfAborted()
    logger.info('创作技能读取完成', { event: 'embedded_agent.skill_load.completed', context: { ...context, bytes: loaded.bytes, source: loaded.source } })
    return { isError: false, structuredContent: { ...loaded,
      content: wrapSkillContent(loaded.name, loaded.source, loaded.path, loaded.content),
    }, content: [] }
  } catch (error) {
    logger.warn('创作技能读取失败', { event: 'embedded_agent.skill_load.failed', context, error })
    throw error
  }
}
