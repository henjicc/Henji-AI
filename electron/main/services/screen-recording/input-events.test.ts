import { expect, it } from 'vitest'
import { UiohookKey } from 'uiohook-napi'
import { keyCategory } from './input-events'
import { capabilityCaptureSchema, captureEventSchema } from '../../../../src/core/captureLog/events'

it('输入只记类别，普通文字与密码没有字符内容出口', () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
  for (const keycode of [UiohookKey.A, UiohookKey.B, UiohookKey.Space, UiohookKey.Backspace]) expect(keyCategory({ ...base, keycode })).toBe('typing')
  expect(keyCategory({ ...base, keycode: UiohookKey.C, ctrlKey: true })).toBe('copy')
  expect(keyCategory({ ...base, keycode: UiohookKey.Z, metaKey: true, shiftKey: true })).toBe('redo')
  expect(keyCategory({ ...base, keycode: UiohookKey.ArrowLeft })).toBe('navigation')
  expect(captureEventSchema.safeParse({ kind: 'key', category: 'typing', keycode: UiohookKey.A }).success).toBe(false)
  const fact = { callId: 'call', capability: 'read_application_entity', targets: [{ kind: 'video_edit.document', id: 'doc' }], phase: 'completed' }
  expect(capabilityCaptureSchema.safeParse(fact).success).toBe(true)
  expect(capabilityCaptureSchema.safeParse({ ...fact, input: { password: 'secret' } }).success).toBe(false)
  expect(capabilityCaptureSchema.safeParse({ ...fact, targets: [{ ...fact.targets[0], label: 'secret' }] }).success).toBe(false)
})
