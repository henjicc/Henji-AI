import { describe, expect, it } from 'vitest'
import type { AuthorElementObservation } from './codeAuthorProgram'
import type { CodeParameterDeclaration, CodeParameterValues } from './codeMaterial/contract'
import { codeAuthorTextParameterValue, readCodeAuthorTextBinding } from './codeAuthorTextBinding'

const text = (key: string): CodeParameterDeclaration & { type: 'text' } => ({ key, type: 'text', title: key, description: '', default: '', animatable: false, maxLength: 100 })
const table: CodeParameterDeclaration = { key: 'nodes', type: 'table', title: '节点', description: '', default: [], animatable: false, rowKey: 'id', fields: { id: text('id'), label: text('label') } }
const author: AuthorElementObservation = { id: 'node-a', name: '节点', bounds: [0, 0, 100, 30], matrix: [1, 0, 0, 1, 0, 0], corners: [], parameterKeys: ['nodes'], textParameterKeys: [], data: { parameter: 'nodes', key: 'a', keyField: 'id', index: 0, value: { id: 'a', label: 'A' } } }

describe('author text editing', () => {
  it('resolves a stable key after a table reorder and only changes that row', () => {
    const values: CodeParameterValues = { nodes: [{ id: 'b', label: 'B' }, { id: 'a', label: 'A' }] }
    const binding = readCodeAuthorTextBinding(author, [table], values)!
    expect(binding).toEqual({ parameter: 'nodes', row: 1, field: 'label', value: 'A' })
    expect(codeAuthorTextParameterValue(binding, values, '新文字')).toEqual([{ id: 'b', label: 'B' }, { id: 'a', label: '新文字' }])
    expect(values.nodes).toEqual([{ id: 'b', label: 'B' }, { id: 'a', label: 'A' }])
  })
  it('does not fall back to the old index when a key is missing or duplicated', () => {
    expect(readCodeAuthorTextBinding(author, [table], { nodes: [{ id: 'b', label: 'B' }] })).toBeUndefined()
    expect(readCodeAuthorTextBinding(author, [table], { nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'copy' }] })).toBeUndefined()
  })
  it('supports explicitly indexed data and refuses ambiguous text fields', () => {
    const indexed = { ...author, data: { parameter: 'nodes', index: 0, value: {} } }
    expect(readCodeAuthorTextBinding(indexed, [table], { nodes: [{ id: 'a', label: 'A' }] })?.value).toBe('A')
    expect(readCodeAuthorTextBinding(indexed, [{ ...table, fields: { ...table.fields, subtitle: text('subtitle') } }], { nodes: [{ id: 'a', label: 'A', subtitle: 'extra' }] })).toBeUndefined()
  })
  it('prefers a single explicit text parameter and rejects multiple choices', () => {
    const bound = { ...author, textParameterKeys: ['heading'] }
    const values = { heading: '标题' }
    const binding = readCodeAuthorTextBinding(bound, [text('heading'), table], values)!
    expect(binding).toEqual({ parameter: 'heading', value: '标题' })
    expect(codeAuthorTextParameterValue(binding, values, '修改')).toBe('修改')
    expect(readCodeAuthorTextBinding({ ...bound, textParameterKeys: ['heading', 'subtitle'] }, [text('heading'), text('subtitle')], values)).toBeUndefined()
  })
})
