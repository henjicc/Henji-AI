import type { ApplicationExecutionContext } from './execution/types'

/** 由应用宿主的授权存储创建，绝不能从工具参数反序列化。 */
export interface ApplicationCallerGrant {
  readonly callerId: string
  readonly capabilityIds: readonly string[]
  readonly permissions: readonly string[]
  readonly allowWrites: boolean
  readonly allowDestructive: boolean
}

const grants = new WeakSet<ApplicationCallerGrant>()
const revoked = new WeakSet<ApplicationCallerGrant>()

export function createApplicationCallerGrant(input: ApplicationCallerGrant): ApplicationCallerGrant {
  const grant = Object.freeze({
    ...input,
    capabilityIds: Object.freeze([...input.capabilityIds]),
    permissions: Object.freeze([...input.permissions]),
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
    permissions: new Set(grant.permissions),
    acceptedDataClasses: new Set(['C0', 'C1']),
    requestId,
    signal,
  }
}

export function assertApplicationCapabilityAllowed(
  grant: ApplicationCallerGrant,
  definition: { id: string; permission: string; readOnly: boolean; destructive: boolean; dataClasses: readonly string[] },
): void {
  assertApplicationCallerGrant(grant)
  if (!grant.capabilityIds.includes(definition.id)
    || !grant.permissions.includes(definition.permission)
    || (!definition.readOnly && !grant.allowWrites)
    || (definition.destructive && !grant.allowDestructive)
    || definition.dataClasses.some((value) => value !== 'C0' && value !== 'C1')) {
    throw new Error(`PERMISSION_DENIED:未授权能力 ${definition.id}，需要 ${definition.permission}；请在应用中调整连接授权。`)
  }
}
