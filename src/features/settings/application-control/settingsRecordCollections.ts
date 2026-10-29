import { listAssistantSkills, uninstallAssistantSkill } from '@/commands/assistant'
import { jsonValueSchema } from '@/core/application-control/identifiers'
import { llmConfigService } from '@/services/llm/LlmConfigService'
import { captureRecycledRemoval, createRecyclableRecordSource } from '@/features/application-control'

export const skillCollection = createRecyclableRecordSource({
  entityType: 'assistant.skill', domain: 'settings', title: '用户技能',
  list: async () => (await listAssistantSkills()).skills.filter(skill => skill.source === 'user').map(skill => ({ id: skill.name, name: skill.name, content: jsonValueSchema.parse(skill) })),
  remove: name => captureRecycledRemoval(() => uninstallAssistantSkill(name), item => item.path?.replaceAll('\\', '/').endsWith(`/${name}`) === true),
})
export const providerCollection = createRecyclableRecordSource({
  entityType: 'settings.llm_provider', domain: 'settings', title: '自定义供应商配置',
  list: async () => (await llmConfigService.getConfig()).providers.filter(provider => !(provider.setup?.kind === 'preset' && provider.setup.lifecycle === 'builtin')).map(provider => ({ id: provider.providerId, name: provider.displayName, content: jsonValueSchema.parse(provider) })),
  remove: id => captureRecycledRemoval(() => llmConfigService.deleteProviderSettings(id), item => item.id.startsWith('llm-provider:')),
})
