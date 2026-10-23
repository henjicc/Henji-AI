import { expect, it } from 'vitest'

import type { ApplicationPlannedStep } from '@/core/application-control'

import { videoEditApplicationDomain } from './applicationDomain'

/*
 * 持久化参与者只登记“属于某份剪辑”的写入：风格库、模板库、预设与风格使用者偏好不在剪辑文件里，
 * 写它们时不能把风格 ID 当成剪辑 ID 去拆（元宝搜索实战里写风格使用者偏好被“请使用完整剪辑实体引用”挡住）。
 */

const resolve = (steps: ApplicationPlannedStep[]) => videoEditApplicationDomain.resolvePersistenceParticipants!(steps)

it('新增与修改风格使用者偏好不按剪辑登记持久化参与者', () => {
  const style = { kind: 'video_edit.style', id: 'e05e7c49-8aa1-4703-a50f-5827cb3bbbc0' }
  const create = {
    kind: 'collection', entityType: 'video_edit.style_preference', parent: style, expectedRevisions: {},
    operation: { kind: 'create', items: [{ properties: { 'video_edit.style_preference.entry': { content: '花字做成节点样式', source: 'assistant' } } }] },
  } as unknown as ApplicationPlannedStep
  const update = {
    kind: 'mutation', entityType: 'video_edit.style_preference', target: { kind: 'video_edit.style_preference', id: `${style.id}:entry-1` }, expectedRevisions: {},
    mutations: [{ propertyId: 'video_edit.style_preference.entry', operation: 'set', value: { content: '改一句', source: 'assistant' } }],
  } as unknown as ApplicationPlannedStep
  expect(resolve([create, update])).toEqual([])
})

it('剪辑里的实体仍按所属剪辑登记（找不到剪辑时如实报错）', () => {
  const clip = {
    kind: 'mutation', entityType: 'video_edit.clip', target: { kind: 'video_edit.clip', id: 'missing-edit:clip-1' }, expectedRevisions: {},
    mutations: [{ propertyId: 'video_edit.clip.name', operation: 'set', value: 'A' }],
  } as unknown as ApplicationPlannedStep
  expect(() => resolve([clip])).toThrow()
})
