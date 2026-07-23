import { shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  applyAssistantModelPreferencesUpdate,
  assistantModelPreferencesSchema,
  assistantModelPreferencesUpdateSchema,
  createDefaultAssistantModelPreferences,
  type AssistantModelPreferences,
  type AssistantModelPreferencesUpdate,
} from '../../../../src/core/assistant/modelPreferences'
import { createMainLogger } from '../logging'
import { getAppLocalDataDir } from '../system'

const logger = createMainLogger('main.assistant_model_preferences')
const PREFERENCES_FILE_NAME = 'model-preferences.json'

export function getAssistantModelPreferencesFilePath(): string {
  return path.join(getAppLocalDataDir(), 'assistant', PREFERENCES_FILE_NAME)
}

async function persistPreferences(
  preferences: AssistantModelPreferences
): Promise<AssistantModelPreferences> {
  const parsed = assistantModelPreferencesSchema.parse(preferences)
  const filePath = getAssistantModelPreferencesFilePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  return parsed
}

export async function getAssistantModelPreferences(): Promise<AssistantModelPreferences> {
  const filePath = getAssistantModelPreferencesFilePath()
  logger.info('读取智能助手模型偏好开始', {
    event: 'assistant_model_preferences.read.start',
  })
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const preferences = assistantModelPreferencesSchema.parse(JSON.parse(raw) as unknown)
    logger.info('读取智能助手模型偏好完成', {
      event: 'assistant_model_preferences.read.completed',
    })
    return preferences
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      const preferences = await persistPreferences(createDefaultAssistantModelPreferences())
      logger.info('创建默认智能助手模型偏好完成', {
        event: 'assistant_model_preferences.create.completed',
      })
      return preferences
    }
    logger.error('读取智能助手模型偏好失败', {
      event: 'assistant_model_preferences.read.failed',
      error,
    })
    throw new Error(`智能助手模型偏好文件格式无效，请检查：${filePath}`, { cause: error })
  }
}

export async function updateAssistantModelPreferences(
  update: AssistantModelPreferencesUpdate
): Promise<AssistantModelPreferences> {
  logger.info('更新智能助手模型偏好开始', {
    event: 'assistant_model_preferences.update.start',
  })
  try {
    const current = await getAssistantModelPreferences()
    const parsedUpdate = assistantModelPreferencesUpdateSchema.parse(update)
    const preferences = await persistPreferences(
      applyAssistantModelPreferencesUpdate(current, parsedUpdate)
    )
    logger.info('更新智能助手模型偏好完成', {
      event: 'assistant_model_preferences.update.completed',
    })
    return preferences
  } catch (error) {
    logger.error('更新智能助手模型偏好失败', {
      event: 'assistant_model_preferences.update.failed',
      error,
    })
    throw error
  }
}

export async function resetAssistantModelPreferences(): Promise<AssistantModelPreferences> {
  logger.info('重置智能助手模型偏好开始', {
    event: 'assistant_model_preferences.reset.start',
  })
  try {
    const preferences = await persistPreferences(createDefaultAssistantModelPreferences())
    logger.info('重置智能助手模型偏好完成', {
      event: 'assistant_model_preferences.reset.completed',
    })
    return preferences
  } catch (error) {
    logger.error('重置智能助手模型偏好失败', {
      event: 'assistant_model_preferences.reset.failed',
      error,
    })
    throw error
  }
}

export async function openAssistantModelPreferencesFile(): Promise<string> {
  logger.info('打开智能助手模型偏好文件开始', {
    event: 'assistant_model_preferences.open_file.start',
  })
  try {
    await getAssistantModelPreferences()
    const filePath = getAssistantModelPreferencesFilePath()
    const message = await shell.openPath(filePath)
    if (message) throw new Error(`无法打开智能助手模型偏好文件：${message}`)
    logger.info('打开智能助手模型偏好文件完成', {
      event: 'assistant_model_preferences.open_file.completed',
    })
    return filePath
  } catch (error) {
    logger.error('打开智能助手模型偏好文件失败', {
      event: 'assistant_model_preferences.open_file.failed',
      error,
    })
    throw error
  }
}
