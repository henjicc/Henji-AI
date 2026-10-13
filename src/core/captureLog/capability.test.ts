import { expect, it } from 'vitest'
import type { ApplicationCapabilityDefinition } from '../application-control/applicationCapabilities'
import { beginHostCapabilityCapture, bindCaptureCapabilitySink, capabilityCaptureTargets } from './capability'
import type { CapabilityCapture } from './events'

it('主进程能力开始/结束同一身份，旧会话迟到结果不进入新会话', () => {
  const old: CapabilityCapture[] = []; const current: CapabilityCapture[] = []
  const definition = { id: 'load_assistant_skill' } as ApplicationCapabilityDefinition
  const closeOld = bindCaptureCapabilitySink(fact => old.push(fact))
  const finish = beginHostCapabilityCapture(definition, { skillId: 'test' }, () => 'call')
  const closeCurrent = bindCaptureCapabilitySink(fact => current.push(fact))
  closeOld(); finish('completed')
  expect(old.map(fact => fact.phase)).toEqual(['started', 'completed']); expect(current).toHaveLength(0)
  closeCurrent()
  beginHostCapabilityCapture(definition, {}, () => { throw new Error('未录制不分配身份') })('failed')
})
it('能力声明解析目标优先；输入引用只保留kind/id，备注、凭据和结果不采集', () => {
  const definition = { id: 'change_application_entities' } as ApplicationCapabilityDefinition
  const input = { changes: [{ ref: { kind: 'settings.registry', id: 'singleton', label: 'secret' }, value: { ref: { kind: 'settings.registry', id: 'password' } } }], metadata: { kind: 'token', id: 'secret' } }
  expect(capabilityCaptureTargets(definition, input)).toEqual([{ kind: 'settings.registry', id: 'singleton' }])
  expect(capabilityCaptureTargets({ ...definition, resolveOperationTargets: () => [{ kind: 'application.navigation', id: 'current' }] }, input)).toEqual([{ kind: 'application.navigation', id: 'current' }])
})
