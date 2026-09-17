import { createApplicationCallerGrant } from '@/core/application-control/callerContext'
import type { ApplicationRef } from '@/core/application-control'
import { APPLICATION_READ_PERMISSIONS, APPLICATION_WRITE_PERMISSIONS } from '@/core/application-control/localHostContracts'
import { createApplicationCapabilitySession, listApplicationCapabilities } from '@/features/application-control/applicationCapabilityService'
import { retainHostContextTracking } from '@/features/application-control/hostContext/hostContext'
import { externalReflectionPermissions } from '@/features/application-control/externalCapabilityInventory'

/** 只替换 IPC 外的存储/像素边界；调用、授权、注册、事务和读回均使用正式实现。 */
export function createApplicationHarness() {
  const definitions = listApplicationCapabilities()
  const dispose = retainHostContextTracking()
  const reflected = externalReflectionPermissions()
  const session = createApplicationCapabilitySession(createApplicationCallerGrant({
    callerId: crypto.randomUUID(), capabilityIds: definitions.map(item => item.id),
    permissions: [...APPLICATION_READ_PERMISSIONS, ...APPLICATION_WRITE_PERMISSIONS, ...reflected.read, ...reflected.write], allowWrites: true, allowDestructive: true,
  }))
  const call = (id: string, input: unknown, expectedRevisions?: Record<string, number>) => {
    const definition = definitions.find(item => item.id === id)
    if (!definition) throw new Error(`能力未公开：${id}`)
    return session.execute({ id, version: definition.version, input, expectedRevisions }, {
      requestId: crypto.randomUUID(), signal: new AbortController().signal,
    })
  }
  const requireResult = async (id: string, input: unknown, expectedRevisions?: Record<string, number>) => {
    const result = await call(id, input, expectedRevisions)
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    return result.data
  }
  const read = (ref: ApplicationRef, propertyIds: string[] = []) => requireResult('read_application_entity', { ref, propertyIds })
  const change = async (ref: ApplicationRef, properties: Record<string, unknown>) => {
    const baseline = await read(ref, Object.keys(properties))
    return call('change_application_entities', { summary: '验证正式实体修改', changes: [
      { kind: 'set_properties', entityType: ref.kind, target: ref, properties },
    ] }, baseline.revisions as Record<string, number>)
  }
  return { session, call, requireResult, read, change, dispose }
}
