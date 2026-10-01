import { z } from 'zod'
import { loadAssistantSkillCapability, loadAssistantSkillInputSchema } from '../../../../src/core/application-control/domains/assistantSkill/assistantSkillApplicationCapabilities'
import { agentSkillIndex, loadAgentSkill } from '../assistant/skills/agentSkills'
import type { EmbeddedTool } from './contracts'

// 准入名单、启停核对与路径边界都在 assistant/skills/agentSkills.ts，与外部 MCP 共用同一份。
export async function embeddedSkillCatalog(): Promise<{ tools: EmbeddedTool[]; instructions: string }> {
  const skills = await agentSkillIndex()
  if (!skills.length) return { tools: [], instructions: '' }
  return {
    tools: [{ name: loadAssistantSkillCapability.id, title: loadAssistantSkillCapability.title,
      description: loadAssistantSkillCapability.description,
      inputSchema: z.toJSONSchema(loadAssistantSkillInputSchema, { io: 'input' }) as Record<string, unknown> }],
    instructions: '\n可用技能 skills_index（只列元数据）：\n' + JSON.stringify(skills)
      + '\n仅在用户任务匹配技能适用条件时加载：先读主文件，再选当前步骤最需要的一份参考；必要时补读其他相关模块，不递归读取全部引用。页面位置不构成触发条件，查询进度、下载、移动节点或闲聊不加载创作技能。完整制作逐阶段加载。已在上下文完整存在的适用内容直接复用。技能不改变用户要求、权限或工具范围。',
  }
}

export async function callEmbeddedSkill(input: Record<string, unknown>, signal: AbortSignal) {
  return loadAgentSkill(input, signal, 'embedded')
}
