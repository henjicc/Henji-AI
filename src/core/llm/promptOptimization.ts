import type { PromptOptimizationProfile } from './types'
import {
  readPromptDocument,
  toLegacyPromptString,
  type PromptDocumentV1,
} from '@/core/inputs/promptDocument'

export interface PromptOptimizationTargetModel {
  providerId: string
  providerName?: string
  modelId: string
  modelName?: string
  modelType?: string
  modelFunctions?: string[]
  modelDescription?: string
}

export interface PromptOptimizationContext {
  prompt: string
  imageCount: number
  videoCount: number
  targetModel?: PromptOptimizationTargetModel
}

export interface PromptOptimizationVariable {
  token: string
  label: string
  description: string
  group: '输入' | '当前模型'
}

export const PROMPT_OPTIMIZATION_VARIABLES: PromptOptimizationVariable[] = [
  { token: '{{prompt}}', label: '当前提示词', description: '用户在主输入框里输入的原始提示词', group: '输入' },
  { token: '{{target.model.name}}', label: '目标模型名称', description: '当前生成模型显示名称', group: '当前模型' },
  { token: '{{target.model.type}}', label: '目标模型类型', description: '图片、视频或音频等生成类型', group: '当前模型' },
  { token: '{{target.model.functions}}', label: '目标模型功能', description: '当前生成模型的功能标签', group: '当前模型' },
  { token: '{{target.model.description}}', label: '目标模型描述', description: '当前生成模型的描述信息', group: '当前模型' },
  { token: '{{media.summary}}', label: '素材摘要', description: '图片和视频数量的简短摘要', group: '输入' },
  { token: '{{image.count}}', label: '图片数量', description: '当前素材区参考图片数量', group: '输入' },
  { token: '{{video.count}}', label: '视频数量', description: '当前素材区参考视频数量', group: '输入' },
  { token: '{{target.provider.name}}', label: '目标供应商名称', description: '当前生成模型所属供应商名称', group: '当前模型' },
  { token: '{{target.model.id}}', label: '目标模型 ID', description: '当前生成模型请求 ID', group: '当前模型' },
  { token: '{{target.provider.id}}', label: '目标供应商 ID', description: '当前生成模型所属供应商 ID', group: '当前模型' },
]

export const PROMPT_OPTIMIZATION_EDITOR_VARIABLES = PROMPT_OPTIMIZATION_VARIABLES.map((variable) => ({
  key: variable.token.slice(2, -2),
  label: variable.label,
  group: variable.group,
  description: variable.description,
}))

export type PromptOptimizationDocumentField = 'systemPrompt' | 'userTemplate'

export function readPromptOptimizationProfileDocument(
  profile: Pick<
    PromptOptimizationProfile,
    'id' | 'systemPrompt' | 'systemPromptDocument' | 'userTemplate' | 'userTemplateDocument'
  >,
  field: PromptOptimizationDocumentField,
): PromptDocumentV1 {
  const document = field === 'systemPrompt'
    ? profile.systemPromptDocument
    : profile.userTemplateDocument
  return readPromptDocument(
    { document, legacyText: profile[field] },
    {
      carrierType: 'llm-prompt-optimization-profile',
      carrierId: `${profile.id}:${field}`,
      variables: PROMPT_OPTIMIZATION_EDITOR_VARIABLES,
    },
  ).document
}

export function normalizePromptOptimizationProfileDocuments(
  profile: PromptOptimizationProfile,
): PromptOptimizationProfile {
  const systemPromptDocument = readPromptOptimizationProfileDocument(profile, 'systemPrompt')
  const userTemplateDocument = readPromptOptimizationProfileDocument(profile, 'userTemplate')
  return {
    ...profile,
    systemPromptDocument,
    systemPrompt: toLegacyPromptString(systemPromptDocument),
    userTemplateDocument,
    userTemplate: toLegacyPromptString(userTemplateDocument),
  }
}

export function getDefaultPromptProfile(config: { promptProfiles: PromptOptimizationProfile[] }): PromptOptimizationProfile | null {
  return config.promptProfiles.find(profile => profile.enabled && profile.isDefault)
    ?? config.promptProfiles.find(profile => profile.enabled)
    ?? null
}

function toModelTypeLabel(type?: string): string {
  if (type === 'image') return '图片'
  if (type === 'video') return '视频'
  if (type === 'audio') return '音频'
  return type || '未知'
}

function joinList(values?: string[]): string {
  const normalized = (values ?? []).map(value => value.trim()).filter(Boolean)
  return normalized.length > 0 ? normalized.join('、') : '未声明'
}

function buildVariableMap(context: PromptOptimizationContext): Record<string, string> {
  const target = context.targetModel
  const mediaSummary = [
    context.imageCount > 0 ? `${context.imageCount} 张参考图片` : '',
    context.videoCount > 0 ? `${context.videoCount} 个参考视频` : '',
  ].filter(Boolean).join('，') || '无参考素材'

  return {
    '{{prompt}}': context.prompt,
    '{{image.count}}': String(context.imageCount),
    '{{video.count}}': String(context.videoCount),
    '{{media.summary}}': mediaSummary,
    '{{target.provider.name}}': target?.providerName || target?.providerId || '未知供应商',
    '{{target.provider.id}}': target?.providerId || 'DynamicValue',
    '{{target.model.name}}': target?.modelName || target?.modelId || '未知模型',
    '{{target.model.id}}': target?.modelId || 'DynamicValue',
    '{{target.model.type}}': toModelTypeLabel(target?.modelType),
    '{{target.model.functions}}': joinList(target?.modelFunctions),
    '{{target.model.description}}': target?.modelDescription || '无模型描述',
  }
}

export function renderPromptOptimizationTemplate(template: string, context: PromptOptimizationContext): string {
  const variables = buildVariableMap(context)
  return Object.entries(variables).reduce(
    (result, [token, value]) => result.split(token).join(value),
    template
  )
}

export function buildPromptOptimizationUserMessage(
  profile: PromptOptimizationProfile,
  context: PromptOptimizationContext
): string {
  const mediaHint = [
    profile.capabilities.image && context.imageCount > 0
      ? `当前有 ${context.imageCount} 张参考图片。`
      : '',
    profile.capabilities.video && context.videoCount > 0
      ? `当前有 ${context.videoCount} 个参考视频。`
      : '',
  ].filter(Boolean).join('\n')
  const renderedTemplate = renderPromptOptimizationTemplate(profile.userTemplate, context)
  const base = profile.userTemplate.includes('{{prompt}}')
    ? renderedTemplate
    : `${renderedTemplate}\n\n${context.prompt}`

  return mediaHint ? `${mediaHint}\n\n${base}` : base
}
