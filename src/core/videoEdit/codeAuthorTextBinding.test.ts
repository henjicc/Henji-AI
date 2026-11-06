import { describe, expect, it } from 'vitest'
import type { AuthorElementObservation } from './codeAuthorProgram'
import type { CodeParameterDeclaration, CodeParameterValues } from './codeMaterial/contract'
import { codeAuthorTextParameterValue, readCodeAuthorTextTargets } from './codeAuthorTextBinding'
import type { TextDrawObservation } from './textDrawObservation'

const readCodeAuthorTextBinding = (...args: Parameters<typeof readCodeAuthorTextTargets>) => { const targets = readCodeAuthorTextTargets(...args); return targets.length === 1 ? targets[0].binding : undefined }
const draw = (sourceText: string, x = 0): TextDrawObservation => ({ sourceText, box: { x, y: 0, width: 100, height: 30 }, matrix: [1, 0, 0, 1, 0, 0], clips: [], opacity: 1, uncovered: [], constraint: { x, y: 0 }, actualLines: 1 } as unknown as TextDrawObservation)

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
    expect(readCodeAuthorTextBinding({ ...bound, textParameterKeys: ['heading', 'subtitle'] }, [text('heading'), text('subtitle')], { ...values, subtitle: '副标题' })).toBeUndefined()
  })
  it('matches each drawn paragraph to the parameter with the same text; unmatched paragraphs stay unbound', () => {
    const element = { ...author, data: undefined, textParameterKeys: ['heading', 'subtitle'], textDraws: [draw('标题'), draw('副标题', 200), draw('写死的字', 400), draw('标题')] }
    const targets = readCodeAuthorTextTargets(element, [text('heading'), text('subtitle')], { heading: '标题', subtitle: '副标题' })
    expect(targets.map(target => [target.text, target.binding?.parameter])).toEqual([['标题', 'heading'], ['副标题', 'subtitle'], ['写死的字', undefined]])
  })
  it('accepts a single composed paragraph for a single candidate and table rows with several text fields', () => {
    expect(readCodeAuthorTextTargets({ ...author, data: undefined, textParameterKeys: ['heading'], textDraws: [draw('标题：')] }, [text('heading')], { heading: '标题' })[0]).toMatchObject({ text: '标题', binding: { parameter: 'heading' } })
    const transformed = readCodeAuthorTextTargets({ ...author, data: undefined, textParameterKeys: ['heading'], textDraws: [draw('HELLO：'), draw('写死', 200)] }, [text('heading')], { heading: 'hello' })
    expect(transformed.map(target => target.binding?.parameter)).toEqual(['heading', undefined])
    const twins = readCodeAuthorTextTargets({ ...author, data: undefined, textParameterKeys: ['a', 'b'], textDraws: [draw('同'), draw('同', 200)] }, [text('a'), text('b')], { a: '同', b: '同' })
    expect(twins.map(target => target.binding?.parameter)).toEqual(['a', 'b'])
    const shadowed = readCodeAuthorTextTargets({ ...author, data: undefined, textParameterKeys: ['a'], textDraws: [draw('影', 4), draw('影')] }, [text('a')], { a: '影' })
    expect(shadowed.map(target => target.binding?.parameter)).toEqual(['a', 'a'])
    const indexed = { ...author, data: { parameter: 'nodes', index: 0, value: {} }, textDraws: [draw('A'), draw('extra', 200)] }
    const targets = readCodeAuthorTextTargets(indexed, [{ ...table, fields: { ...table.fields, subtitle: text('subtitle') } }], { nodes: [{ id: 'a', label: 'A', subtitle: 'extra' }] })
    expect(targets.map(target => target.binding)).toEqual([{ parameter: 'nodes', row: 0, field: 'label', value: 'A' }, { parameter: 'nodes', row: 0, field: 'subtitle', value: 'extra' }])
  })
})
