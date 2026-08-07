import { describe, expect, it } from 'vitest'

import { applyWriterTable } from './execution/writerTable'
import {
  fieldDescriptors,
  fieldLedgerEntries,
  fieldReadValues,
  fieldWriterTable,
  type ApplicationFieldDefinition,
} from './fieldDefinition'

/*
 * 自造的最小样例：不依赖任何 feature，只用来验证「一条声明派生出四样产物」这条机制契约。
 */
interface FakeSource { label: string }
interface FakeDraft { label: string }

function makeDescriptor(id: string, readOnlyReason?: string) {
  return {
    id,
    entityType: 'fake.entity',
    version: 1,
    title: '样例字段',
    description: '仅用于机制自测的样例字段。',
    value: { kind: 'string' as const, maxLength: 200 },
    nullable: false,
    dataClass: 'C1' as const,
    exposures: ['ui', 'assistant', 'local_adapter'] as ('ui' | 'assistant' | 'local_adapter')[],
    requiredPermissions: { read: [], write: readOnlyReason ? [] : ['fake:write'] },
    revisionScopes: ['fake_scope'],
    schemaRef: {
      catalogVersion: 'application-capabilities/v1' as const,
      kind: 'property' as const,
      id,
      version: 1,
      digest: `sha256:${'a'.repeat(64)}`,
    },
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

const writableField: ApplicationFieldDefinition<FakeSource, FakeDraft> = {
  propertyId: 'fake.entity.label',
  descriptor: makeDescriptor('fake.entity.label'),
  read: (source) => source.label,
  writer: { write: (draft, mutation) => { draft.label = String(mutation.value) } },
  storeActions: ['setLabel'],
}

const readOnlyField: ApplicationFieldDefinition<FakeSource, FakeDraft> = {
  propertyId: 'fake.entity.derived_label',
  descriptor: makeDescriptor('fake.entity.derived_label', '由 label 派生，不直接写入。'),
  read: (source) => source.label.toUpperCase(),
  storeActions: [],
}

describe('fieldDefinition', () => {
  const fields = [writableField, readOnlyField]

  it('一条声明派生出描述符、读取值、写入表项、账本条目四样产物', () => {
    expect(fieldDescriptors(fields).map((d) => d.id)).toEqual([
      'fake.entity.label',
      'fake.entity.derived_label',
    ])

    expect(fieldReadValues(fields, { label: 'hello' })).toEqual({
      'fake.entity.label': 'hello',
      'fake.entity.derived_label': 'HELLO',
    })

    const table = fieldWriterTable(fields)
    expect(Object.keys(table)).toEqual(['fake.entity.label'])

    expect(fieldLedgerEntries(fields)).toEqual({
      setLabel: { kind: 'property', propertyIds: ['fake.entity.label'] },
    })
  })

  it('不给 writer 的字段不出现在写入表里', () => {
    const table = fieldWriterTable([readOnlyField])
    expect(table).toEqual({})
  })

  it('storeActions 为空时不产生账本条目', () => {
    expect(fieldLedgerEntries([readOnlyField])).toEqual({})
  })

  it('fieldWriterTable() 的结果能被 applyWriterTable() 直接消费', async () => {
    const table = fieldWriterTable(fields)
    const draft: FakeDraft = { label: 'old' }
    await applyWriterTable(table, draft, [
      { propertyId: 'fake.entity.label', operation: 'set', value: 'new' },
    ])
    expect(draft.label).toBe('new')
  })

  it('多个字段共用同一个 store 动作时，账本条目按声明顺序累积 propertyIds 而不是互相覆盖', () => {
    const firstField: ApplicationFieldDefinition<FakeSource, FakeDraft> = {
      propertyId: 'fake.entity.first',
      descriptor: makeDescriptor('fake.entity.first'),
      read: (source) => source.label,
      writer: { write: (draft, mutation) => { draft.label = String(mutation.value) } },
      storeActions: ['updateBoth'],
    }
    const secondField: ApplicationFieldDefinition<FakeSource, FakeDraft> = {
      propertyId: 'fake.entity.second',
      descriptor: makeDescriptor('fake.entity.second'),
      read: (source) => source.label,
      writer: { write: (draft, mutation) => { draft.label = String(mutation.value) } },
      storeActions: ['updateBoth'],
    }
    expect(fieldLedgerEntries([firstField, secondField])).toEqual({
      updateBoth: { kind: 'property', propertyIds: ['fake.entity.first', 'fake.entity.second'] },
    })
  })
})
