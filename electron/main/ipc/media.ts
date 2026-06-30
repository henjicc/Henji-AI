import { allowMediaRoot, isPathWithinAllowedMediaRoots } from '../protocol'
import { parseRecord, registerIpcHandler } from './registry'

interface AllowRootPayload {
  rootPath: string
}

interface IsPathAllowedPayload {
  targetPath: string
}

function parseAllowRootPayload(input: unknown): AllowRootPayload {
  const record = parseRecord(input)
  const rootPath = record.rootPath
  if (typeof rootPath !== 'string' || rootPath.length === 0) {
    throw new Error('Expected non-empty string field "rootPath"')
  }
  return { rootPath }
}

function parseIsPathAllowedPayload(input: unknown): IsPathAllowedPayload {
  const record = parseRecord(input)
  const targetPath = record.targetPath
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('Expected non-empty string field "targetPath"')
  }
  return { targetPath }
}

export function registerMediaIpc(): void {
  registerIpcHandler<AllowRootPayload, void>('media:allowRoot', parseAllowRootPayload, ({ rootPath }) => {
    allowMediaRoot(rootPath)
  })

  registerIpcHandler<IsPathAllowedPayload, boolean>('media:isPathAllowed', parseIsPathAllowedPayload, ({ targetPath }) => {
    return isPathWithinAllowedMediaRoots(targetPath)
  })
}
