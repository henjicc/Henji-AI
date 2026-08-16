import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
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

export function getAssistantUserInstructionsFilePath(): string {
  return path.join(getAppLocalDataDir(), 'assistant', USER_INSTRUCTIONS_FILE_NAME)
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
      const instructions = await persistInstructions('')
      logger.info('创建智能助手用户指令文件完成', {
        event: 'assistant_user_instructions.create.completed',
      })
      return instructions
    }
    logger.error('读取智能助手用户指令失败', {
      event: 'assistant_user_instructions.read.failed',
      error,
    })
    const wrapped = new Error(`智能助手用户指令文件无效，请检查内容长度和格式：${filePath}`)
    ;(wrapped as Error & { cause?: unknown }).cause = error
    throw wrapped
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
