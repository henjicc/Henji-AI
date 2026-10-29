import type { ApplicationExecutionContext } from './execution/types'

/** 由可信宿主创建调用身份，工具参数不能冒充调用者。 */
export interface ApplicationCallerGrant {
  readonly callerId: string
}

const grants = new WeakSet<ApplicationCallerGrant>()
const revoked = new WeakSet<ApplicationCallerGrant>()

export function createApplicationCallerGrant(input: ApplicationCallerGrant): ApplicationCallerGrant {
  const grant = Object.freeze({
    ...input,
  })
  grants.add(grant)
  return grant
}

export function revokeApplicationCallerGrant(grant: ApplicationCallerGrant): void {
  revoked.add(grant)
}

export function assertApplicationCallerGrant(grant: ApplicationCallerGrant): void {
  if (!grants.has(grant) || revoked.has(grant)) {
    throw new Error('PERMISSION_DENIED:连接尚未授权或已撤销，请在应用中重新授权连接。')
  }
}

export function applicationCallerAccess(
  grant: ApplicationCallerGrant, requestId: string, signal: AbortSignal,
): ApplicationExecutionContext {
  assertApplicationCallerGrant(grant)
  return {
    exposure: 'local_adapter',
    permissions: new Set(),
    acceptedDataClasses: new Set(['C0', 'C1', 'C2']),
    requestId,
    signal,
  }
}

export function assertApplicationCapabilityAllowed(
  grant: ApplicationCallerGrant,
  definition: { id: string; dataClasses: readonly string[] },
): void {
  assertApplicationCallerGrant(grant)
  if (definition.dataClasses.includes('C3')) {
    throw new Error(`PERMISSION_DENIED:能力 ${definition.id} 涉及密钥，不能向助手提供。`)
  }
}
