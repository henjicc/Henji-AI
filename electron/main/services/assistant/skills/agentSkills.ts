import { loadAssistantSkillInputSchema } from '../../../../../src/core/application-control/domains/assistantSkill/assistantSkillApplicationCapabilities'
import { AssistantSkillError, isAssistantSkillError, type AssistantSkillMetadata } from '../../../../../src/core/assistant/skills'
import { createMainLogger } from '../../logging'
import { wrapSkillContent } from './content'
import { listEnabledAssistantSkills, loadAssistantSkill } from './registry'

const logger = createMainLogger('main.assistant_skills')

/**
 * 智能体可用技能的唯一准入名单，内置 Pi 与外部 MCP 共用。
 *
 * 旧的中文内置技能（图片生成、生成排障、三维镜头构图）仍依赖已移除的自研助手协议，
 * 未迁移前不能交给任何智能体；用户自装技能同样要经过适配后才加入。启用/停用、覆盖来源、
 * 路径与大小限制仍全部由正式注册表在每次读取时核对，这里只决定"哪些名字可被智能体看见"。
 */
export const AGENT_SKILL_NAMES: ReadonlySet<string> = new Set([
  'prompt-optimization', 'cinematic-director', 'short-drama', 'video-edit-code-creation',
])

export type AgentSkillCaller = 'embedded' | 'external'

/** 已启用且已准入的技能元数据；扫描失败按"本轮没有技能"处理。 */
export async function listAgentSkills(): Promise<AssistantSkillMetadata[]> {
  return (await listEnabledAssistantSkills()).filter(skill => AGENT_SKILL_NAMES.has(skill.name))
}

/** 首轮只给名称与适用条件，正文和参考按需读取。 */
export async function agentSkillIndex(): Promise<Array<{ name: string; description: string }>> {
  return (await listAgentSkills()).map(({ name, description }) => ({ name, description }))
}

/**
 * 拒绝时带上运行时已知的可选项，让调用方改道而不是猜：名字错了列出可用技能，
 * 路径错了列出该技能真实存在的参考文件。
 */
async function withRecovery(error: unknown, name: string): Promise<unknown> {
  if (!isAssistantSkillError(error)) return error
  const skills = await listAgentSkills()
  const hint = error.code === 'SKILL_NOT_FOUND' || error.code === 'SKILL_DISABLED'
    ? `可用技能：${skills.map(skill => skill.name).join('、') || '无'}`
    : error.code === 'SKILL_REFERENCE_NOT_FOUND' || error.code === 'SKILL_PATH_REJECTED'
      ? `可用参考：${skills.find(skill => skill.name === name)?.referencePaths.join('、') || '无'}`
      : ''
  return hint ? new AssistantSkillError(error.code, `${error.message}。${hint}`, { cause: error }) : error
}

/** 按需读取技能正文或单份参考；每次都经正式注册表核对启用状态与路径边界。 */
export async function loadAgentSkill(input: unknown, signal: AbortSignal, caller: AgentSkillCaller) {
  signal.throwIfAborted()
  const args = loadAssistantSkillInputSchema.parse(input)
  const context = { caller, name: args.name, path: args.path ?? 'SKILL.md', reason: args.reason }
  logger.info('按需读取智能体技能', { event: 'assistant_skill.agent_load.start', context })
  try {
    if (!AGENT_SKILL_NAMES.has(args.name)) {
      throw new AssistantSkillError('SKILL_NOT_FOUND', `技能 ${args.name} 尚未适配智能体`)
    }
    const loaded = await loadAssistantSkill(args.name, args.path)
    signal.throwIfAborted()
    logger.info('智能体技能读取完成', { event: 'assistant_skill.agent_load.completed', context: { ...context, bytes: loaded.bytes, source: loaded.source } })
    return { ok: true as const, data: { ...loaded, content: wrapSkillContent(loaded.name, loaded.source, loaded.path, loaded.content) } }
  } catch (error) {
    const reported = signal.aborted ? error : await withRecovery(error, args.name)
    logger.warn('智能体技能读取失败', { event: 'assistant_skill.agent_load.failed', context, error: reported })
    throw reported
  }
}
