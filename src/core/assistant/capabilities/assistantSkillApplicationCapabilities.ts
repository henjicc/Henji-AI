import { z } from 'zod'

import {
  ASSISTANT_SKILL_MAX_NAME_LENGTH,
  assistantSkillDetailSchema,
  assistantSkillNameSchema,
  assistantSkillReferencePathSchema,
} from '../skills'
import type { ApplicationCapabilityDefinition } from '../applicationCapabilities'
import { capabilityControl, defineApplicationCapability } from './defineApplicationCapability'

export const loadAssistantSkillInputSchema = z.object({
  name: assistantSkillNameSchema,
  path: assistantSkillReferencePathSchema.optional(),
  reason: z.string().min(1).max(500),
}).strict()

export const loadAssistantSkillOutputSchema = assistantSkillDetailSchema.extend({
  referencePaths: z.array(assistantSkillReferencePathSchema),
}).strict()

/**
 * 技能的按需加载入口，实现标准 Skills 的两级渐进披露：不传 `path` 读 `SKILL.md` 正文并
 * 附上引用清单，传 `path` 读对应引用文件。用一个能力两种入参，不另建第二个工具。
 *
 * 技能在本项目里只是提示词文本，因此这里没有任何工具授权语义：能力输出不含
 * `allowed-tools` 等未知 frontmatter 字段，也不参与本轮工具激活。
 */
export const loadAssistantSkillCapability = defineApplicationCapability({
  id: 'load_assistant_skill',
  version: 1,
  title: '加载助手技能',
  description: '按 skills_index 里的技能名读取该技能的完整操作说明；正文提到 references/ 下的文件时，再用 path 参数读取对应引用文件。',
  domain: 'application',
  aliases: ['加载技能', '读取技能', '技能说明', 'load skill', 'skill'],
  side: 'backend',
  readOnly: true,
  control: capabilityControl('observe', ['assistant.skill']),
  risk: 'R0',
  dataClasses: ['C1'],
  permission: 'application:read',
  idempotent: true,
  destructive: false,
  timeoutMs: 5_000,
  supportsPreview: false,
  supportsUndo: false,
  requiredScopes: [],
  inputSchema: loadAssistantSkillInputSchema,
  outputSchema: loadAssistantSkillOutputSchema,
  concurrencyKey: 'assistant_skills',
  aiInputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        maxLength: ASSISTANT_SKILL_MAX_NAME_LENGTH,
        description: '技能名，必须来自本轮 skills_index 层列出的条目，不得猜测。',
      },
      path: {
        type: 'string',
        description: '留空读取技能正文；正文里提到 references/xxx.md 时填该相对路径读取引用文件。',
      },
      reason: {
        type: 'string',
        maxLength: 500,
        description: '本次需要该技能的原因，一句话即可。',
      },
    },
    required: ['name', 'reason'],
    additionalProperties: false,
  },
  successEvidence: [
    '返回的技能名与请求一致，内容带 ASSISTANT_SKILL 信任标记，并附该技能的引用文件清单。',
  ],
  failureRecovery: [
    'SKILL_NOT_FOUND 或 SKILL_DISABLED 时只能改用 skills_index 中列出的已启用技能，禁止换名重试；SKILL_REFERENCE_NOT_FOUND 或路径被拒绝时只能使用上一次返回的 referencePaths 中的路径。',
  ],
  resolveTargetIds: (input): Record<string, string> => {
    const targetIds: Record<string, string> = { skill: input.name }
    if (input.path) targetIds.path = input.path
    return targetIds
  },
  summarize: (output) => (
    output.path
      ? `已加载技能 ${output.name} 的引用文件 ${output.path}。`
      : `已加载技能 ${output.name} 的操作说明。`
  ),
})

export const ASSISTANT_SKILL_APPLICATION_CAPABILITIES: ApplicationCapabilityDefinition[] = [
  loadAssistantSkillCapability,
]
