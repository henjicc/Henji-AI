import { allowMediaRoot } from '../protocol'
import { parseRecord, registerIpcHandler } from './registry'

interface AllowRootPayload {
  rootPath: string
}

function parseAllowRootPayload(input: unknown): AllowRootPayload {
  const record = parseRecord(input)
  const rootPath = record.rootPath
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    throw new Error('Expected non-empty string field "rootPath"')
  }
  return { rootPath }
}

export function registerMediaIpc(): void {
  registerIpcHandler<AllowRootPayload, void>('media:allowRoot', parseAllowRootPayload, ({ rootPath }) => {
    allowMediaRoot(rootPath)
  })
}
