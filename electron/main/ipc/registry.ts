import { ipcMain, type IpcMainInvokeEvent } from 'electron'

export interface IpcErrorEnvelope {
  name: string
  message: string
  code: string
  stack?: string
}

export type IpcResultEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcErrorEnvelope }

export type IpcParser<T> = (input: unknown) => T
export type IpcHandler<TInput, TResult> = (
  input: TInput,
  event: IpcMainInvokeEvent
) => TResult | Promise<TResult>

export function parseVoid(input: unknown): void {
  if (input !== undefined) {
    throw new Error('Expected no IPC payload')
  }
}

export function parseRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Expected IPC payload object')
  }
  return input as Record<string, unknown>
}

export function parseStringField(input: unknown, field: string): string {
  const record = parseRecord(input)
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

export function parseOptionalStringField(input: unknown, field: string): string | undefined {
  const record = parseRecord(input)
  const value = record[field]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`Expected string field "${field}"`)
  }
  return value
}

function normalizeError(error: unknown): IpcErrorEnvelope {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      code: error.name || 'Error',
      stack: error.stack,
    }
  }

  return {
    name: 'Error',
    message: typeof error === 'string' ? error : 'Unknown IPC error',
    code: 'UnknownError',
  }
}

export function registerIpcHandler<TInput, TResult>(
  channel: string,
  parser: IpcParser<TInput>,
  handler: IpcHandler<TInput, TResult>
): void {
  ipcMain.handle(channel, async (event, rawInput): Promise<IpcResultEnvelope<TResult>> => {
    try {
      const input = parser(rawInput)
      const data = await handler(input, event)
      return { ok: true, data }
    } catch (error) {
      return {
        ok: false,
        error: normalizeError(error),
      }
    }
  })
}

export function registerPingIpc(): void {
  registerIpcHandler('system:ping', parseVoid, () => ({
    pong: true,
    timestamp: Date.now(),
  }))
}
