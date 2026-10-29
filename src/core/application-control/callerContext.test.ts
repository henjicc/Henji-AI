import { expect, it } from 'vitest'
import { applicationCallerAccess, assertApplicationCapabilityAllowed, createApplicationCallerGrant, revokeApplicationCallerGrant } from './callerContext'

it('调用身份可读写 C2，密钥 C3、伪造身份和已撤销连接仍被拒绝', () => {
  const grant = createApplicationCallerGrant({ callerId: 'caller' })
  const definition = { id: 'body', dataClasses: ['C2'] }
  assertApplicationCapabilityAllowed(grant, definition)
  expect(applicationCallerAccess(grant, 'read', new AbortController().signal).acceptedDataClasses.has('C2')).toBe(true)
  expect(() => assertApplicationCapabilityAllowed(grant, { ...definition, dataClasses: ['C3'] })).toThrow('PERMISSION_DENIED')
  expect(() => assertApplicationCapabilityAllowed({ ...grant }, definition)).toThrow('PERMISSION_DENIED')
  revokeApplicationCallerGrant(grant)
  expect(() => assertApplicationCapabilityAllowed(grant, definition)).toThrow('PERMISSION_DENIED')
})
