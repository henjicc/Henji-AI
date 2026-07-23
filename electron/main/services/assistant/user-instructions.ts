import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS,
  ASSISTANT_USER_INSTRUCTIONS_SCHEMA_VERSION,
  assistantUserInstructionsSchema,
  assistantUserInstructionsUpdateSchema,
  normalizeAssistantUserInstructionsContent,
  type AssistantUserInstructions,
  type AssistantUserInstructionsUpdate,
} from '../../../../src/core/assistant/userInstructions'
import { createMainLogger } from '../logging'
import { getAppLocalDataDir } from '../system'

const logger = createMainLogger('main.assistant_user_instructions')
const USER_INSTRUCTIONS_FILE_NAME = 'user-instructions.md'
const LEGACY_MODEL_PREFERENCES_FILE_NAME = 'model-preferences.json'

export function getAssistantUserInstructionsFilePath(): string {
  return path.join(getAppLocalDataDir(), 'assistant', USER_INSTRUCTIONS_FILE_NAME)
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function legacyModels(value: unknown, label: string): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [
    ...stringList(record['image']).map((item) => `${label}图片模型：${item}。`),
    ...stringList(record['video']).map((item) => `${label}视频模型：${item}。`),
    ...stringList(record['audio']).map((item) => `${label}音频模型：${item}。`),
  ]
}

async function readLegacyModelPreferences(): Promise<string> {
  const legacyPath = path.join(
    getAppLocalDataDir(),
    'assistant',
    LEGACY_MODEL_PREFERENCES_FILE_NAME
  )
  try {
    const parsed = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return ''
    const record = parsed as Record<string, unknown>
    const strategyLabels: Record<string, string> = {
      quality: '生成模型选择时质量优先。',
      speed: '生成模型选择时速度优先。',
      cost: '生成模型选择时成本优先。',
      balanced: '生成模型选择时综合平衡质量、速度与成本。',
    }
    const strategy = typeof record['strategy'] === 'string'
      ? strategyLabels[record['strategy']]
      : undefined
    const lines = [
      strategy,
      ...stringList(record['preferredProviders']).map((item) => `优先使用供应商：${item}。`),
      ...stringList(record['avoidedProviders']).map((item) => `避免使用供应商：${item}。`),
      ...legacyModels(record['preferredModels'], '优先使用'),
      ...legacyModels(record['avoidedModels'], '避免使用'),
      typeof record['notes'] === 'string' ? record['notes'].trim() : '',
    ].filter((item): item is string => Boolean(item))
    return normalizeAssistantUserInstructionsContent(
      lines.join('\n').slice(0, ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS)
    )
  } catch {
    return ''
  }
}

async function persistInstructions(content: string): Promise<AssistantUserInstructions> {
  const normalized = normalizeAssistantUserInstructionsContent(content)
  const filePath = getAssistantUserInstructionsFilePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, normalized ? `${normalized}\n` : '', 'utf8')
  const stats = await fs.stat(filePath)
  return assistantUserInstructionsSchema.parse({
    schemaVersion: ASSISTANT_USER_INSTRUCTIONS_SCHEMA_VERSION,
    content: normalized,
    updatedAt: stats.mtime.toISOString(),
  })
}

export async function getAssistantUserInstructions(): Promise<AssistantUserInstructions> {
  const filePath = getAssistantUserInstructionsFilePath()
  logger.info('读取智能助手用户指令开始', {
    event: 'assistant_user_instructions.read.start',
  })
  try {
    const content = normalizeAssistantUserInstructionsContent(await fs.readFile(filePath, 'utf8'))
    const stats = await fs.stat(filePath)
    const instructions = assistantUserInstructionsSchema.parse({
      schemaVersion: ASSISTANT_USER_INSTRUCTIONS_SCHEMA_VERSION,
      content,
      updatedAt: stats.mtime.toISOString(),
    })
    logger.info('读取智能助手用户指令完成', {
      event: 'assistant_user_instructions.read.completed',
      context: { hasContent: content.length > 0 },
    })
    return instructions
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const legacyContent = await readLegacyModelPreferences()
      const instructions = await persistInstructions(legacyContent)
      logger.info('创建智能助手用户指令文件完成', {
        event: legacyContent
          ? 'assistant_user_instructions.migrate.completed'
          : 'assistant_user_instructions.create.completed',
      })
      return instructions
    }
    logger.error('读取智能助手用户指令失败', {
      event: 'assistant_user_instructions.read.failed',
      error,
    })
    throw new Error(`智能助手用户指令文件无效，请检查内容长度和格式：${filePath}`, {
      cause: error,
    })
  }
}

export async function updateAssistantUserInstructions(
  update: AssistantUserInstructionsUpdate
): Promise<AssistantUserInstructions> {
  logger.info('更新智能助手用户指令开始', {
    event: 'assistant_user_instructions.update.start',
  })
  try {
    const parsed = assistantUserInstructionsUpdateSchema.parse(update)
    const instructions = await persistInstructions(parsed.content)
    logger.info('更新智能助手用户指令完成', {
      event: 'assistant_user_instructions.update.completed',
      context: { hasContent: instructions.content.length > 0 },
    })
    return instructions
  } catch (error) {
    logger.error('更新智能助手用户指令失败', {
      event: 'assistant_user_instructions.update.failed',
      error,
    })
    throw error
  }
}

export async function resetAssistantUserInstructions(): Promise<AssistantUserInstructions> {
  logger.info('清空智能助手用户指令开始', {
    event: 'assistant_user_instructions.reset.start',
  })
  try {
    const instructions = await persistInstructions('')
    logger.info('清空智能助手用户指令完成', {
      event: 'assistant_user_instructions.reset.completed',
    })
    return instructions
  } catch (error) {
    logger.error('清空智能助手用户指令失败', {
      event: 'assistant_user_instructions.reset.failed',
      error,
    })
    throw error
  }
}

export async function openAssistantUserInstructionsFile(): Promise<string> {
  logger.info('打开智能助手用户指令文件开始', {
    event: 'assistant_user_instructions.open_file.start',
  })
  try {
    await getAssistantUserInstructions()
    const filePath = getAssistantUserInstructionsFilePath()
    const message = await shell.openPath(filePath)
    if (message) throw new Error(`无法打开智能助手用户指令文件：${message}`)
    logger.info('打开智能助手用户指令文件完成', {
      event: 'assistant_user_instructions.open_file.completed',
    })
    return filePath
  } catch (error) {
    logger.error('打开智能助手用户指令文件失败', {
      event: 'assistant_user_instructions.open_file.failed',
      error,
    })
    throw error
  }
}
