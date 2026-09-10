// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NodeParamControl } from './NodeParamControl'

vi.mock('@/components/ui/PanelTrigger', () => ({ default: ({ display }: { display: string }) => <span>{display}</span> }))
afterEach(cleanup)

it('原生 aspect-ratio 参数复用比例控件，不再只有标签的空行', () => {
  render(<NodeParamControl param={{ id: 'aspect', type: 'aspect-ratio', name: '比例', order: 1,
    default: '3:4', options: [{ value: '3:4', label: '3:4' }, { value: '1:1', label: '1:1' }] }}
    value={undefined} onChange={vi.fn()} allValues={{}} onParamChange={vi.fn()}
    onParamChanges={vi.fn()} historyGroup="test" />)
  expect(screen.getByText('3:4')).toBeTruthy()
})
