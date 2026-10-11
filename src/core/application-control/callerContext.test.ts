import { expect, it, vi } from 'vitest'
import { applicationCallerAccess, assertApplicationCapabilityAllowed, createApplicationCallerGrant, revokeApplicationCallerGrant } from './callerContext'

const definition = { id: 'private', permission: 'video_edit:read', readOnly: true, destructive: false, dataClasses: ['C2'] }
const input = { callerId: 'caller', capabilityIds: ['private'], permissions: ['video_edit:read'], allowWrites: false, allowDestructive: false }
it('C2 requires a trusted live resource grant, preserves write limits and rejects forged/revoked grants', () => {
  const ordinary = createApplicationCallerGrant(input)
  expect(() => assertApplicationCapabilityAllowed(ordinary, definition)).toThrow('PERMISSION_DENIED')
  const current = vi.fn(), grant = createApplicationCallerGrant({ ...input, privateAccess: { assertCurrent: current } })
  assertApplicationCapabilityAllowed(grant, definition)
  expect(applicationCallerAccess(grant, 'read', new AbortController().signal).acceptedDataClasses.has('C2')).toBe(true)
  expect(() => assertApplicationCapabilityAllowed(grant, { ...definition, readOnly: false })).toThrow('PERMISSION_DENIED')
  expect(() => assertApplicationCapabilityAllowed({ ...grant }, definition)).toThrow('PERMISSION_DENIED')
  current.mockImplementation(() => { throw new Error('consent revoked') })
  expect(() => applicationCallerAccess(grant, 'read', new AbortController().signal)).toThrow('consent revoked')
  current.mockReset(); revokeApplicationCallerGrant(grant)
  expect(() => assertApplicationCapabilityAllowed(grant, definition)).toThrow('PERMISSION_DENIED')
})
