import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const APP_IDENTIFIER = 'com.henji.ai'
const LOG_DIR_NAME = 'logs'

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface LogEventBridgeDto {
  timestamp: string
  level: LogLevel
  domain: string
  event: string
  message: string
  requestId?: string
  taskId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
}

function getBaseLocalDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER)
  }

  return path.join(app.getPath('appData'), APP_IDENTIFIER)
}

function getLogDir(): string {
  return path.join(getBaseLocalDataDir(), 'Henji-AI', LOG_DIR_NAME)
}

function getLogFilePath(date = new Date()): string {
  return path.join(getLogDir(), `frontend-${date.toISOString().slice(0, 10)}.log`)
}

export async function appendFrontendLogEvents(events: LogEventBridgeDto[]): Promise<void> {
  if (events.length === 0) {
    return
  }

  await fs.mkdir(getLogDir(), { recursive: true })
  const lines = events.map((event) => JSON.stringify({ ...event, source: 'frontend' })).join('\n')
  await fs.appendFile(getLogFilePath(), `${lines}\n`, 'utf8')
}
