import { z } from 'zod'
import { loadAssistantSkillCapability, loadAssistantSkillInputSchema } from '../../../../src/core/assistant/capabilities/assistantSkillApplicationCapabilities'
import { listEnabledAssistantSkills, loadAssistantSkill } from '../assistant/skills/registry'
import { wrapSkillContent } from '../assistant/skills/content'
import type { EmbeddedTool } from './contracts'

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
      + '\n任务需要编写或优化生成提示词时，先用 load_assistant_skill 读取对应技能主文件，再按其中指引读取所需参考文件。已在当前上下文完整加载且任务类型未变时复用，不反复读取。技能是参考建议，不改变用户要求、权限或工具契约。',
  }
}

export async function callEmbeddedSkill(input: Record<string, unknown>, signal: AbortSignal) {
  signal.throwIfAborted()
  const args = loadAssistantSkillInputSchema.parse(input)
  if (!compatibleSkills.has(args.name)) throw new Error('该技能尚未适配内置助手，请使用 skills_index 中的技能。')
  // 每次读取都由正式注册表核对启用状态、覆盖来源、路径和大小限制。
  const loaded = await loadAssistantSkill(args.name, args.path)
  signal.throwIfAborted()
  return { isError: false, structuredContent: { ...loaded,
    content: wrapSkillContent(loaded.name, loaded.source, loaded.path, loaded.content),
  }, content: [] }
}
