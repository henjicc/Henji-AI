/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * Virtuoso 按容器实际高度决定渲染哪几行，而 jsdom 里所有高度都是 0——不 mock 的话一行都
 * 渲染不出来，测的就不是这个组件的逻辑了。这里替换成"全量渲染"，行为等价且与虚拟化无关。
 */
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: {
    data: unknown[]
    itemContent: (index: number, item: unknown) => React.ReactNode
  }) => <div>{data.map((item, index) => <div key={index}>{itemContent(index, item)}</div>)}</div>,
}))

import { ModelSyncDialog } from './ModelSyncDialog'

afterEach(cleanup)

/*
 * 回归：获取模型列表后把远端返回的模型全部写进配置。
 *
 * 硅基流动一次返回 118 个，用户打开设置看到的是一屏自己没选过的模型。这个弹窗的契约是
 * "取回来给用户看，由用户决定加哪些"——所以它自己不落库，只发 onAdd/onRemove。
 */
const DISCOVERED = [
  { modelId: 'moonshotai/Kimi-K2.7-Code', displayName: 'Kimi K2.7 Code' },
  { modelId: 'moonshotai/Kimi-Linear', displayName: 'Kimi Linear' },
  { modelId: 'zai-org/GLM-5.2', displayName: 'GLM 5.2' },
  { modelId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' },
]

function renderDialog(overrides: Partial<Parameters<typeof ModelSyncDialog>[0]> = {}) {
  const onAdd = vi.fn()
  const onRemove = vi.fn()
  render(
    <ModelSyncDialog
      open
      providerName="硅基流动"
      discovered={DISCOVERED}
      addedModelIds={new Set()}
      onClose={vi.fn()}
      onAdd={onAdd}
      onRemove={onRemove}
      {...overrides}
    />
  )
  return { onAdd, onRemove }
}

describe('ModelSyncDialog', () => {
  it('按厂商前缀分组，无前缀的归到其他', () => {
    renderDialog()
    expect(screen.getByText('moonshotai')).toBeTruthy()
    expect(screen.getByText('zai-org')).toBeTruthy()
    expect(screen.getByText('其他')).toBeTruthy()
  })

  it('单行 + 只添加该模型，不牵连同组其他模型', () => {
    const { onAdd } = renderDialog()
    fireEvent.click(screen.getByLabelText('添加 zai-org/GLM-5.2'))
    expect(onAdd).toHaveBeenCalledWith(['zai-org/GLM-5.2'])
  })

  it('组头 + 添加整组，且跳过已添加的', () => {
    const { onAdd } = renderDialog({
      addedModelIds: new Set(['moonshotai/Kimi-Linear']),
    })
    fireEvent.click(screen.getByLabelText('添加 moonshotai 全部模型'))
    expect(onAdd).toHaveBeenCalledWith(['moonshotai/Kimi-K2.7-Code'])
  })

  it('整组已添加时组头变成移除', () => {
    const { onRemove } = renderDialog({
      addedModelIds: new Set(['moonshotai/Kimi-K2.7-Code', 'moonshotai/Kimi-Linear']),
    })
    fireEvent.click(screen.getByLabelText('移除 moonshotai 全部模型'))
    expect(onRemove).toHaveBeenCalledWith(['moonshotai/Kimi-K2.7-Code', 'moonshotai/Kimi-Linear'])
  })

  it('已添加的单行显示为移除', () => {
    const { onRemove } = renderDialog({ addedModelIds: new Set(['deepseek-v4-flash']) })
    fireEvent.click(screen.getByLabelText('移除 deepseek-v4-flash'))
    expect(onRemove).toHaveBeenCalledWith(['deepseek-v4-flash'])
  })

  it('搜索按 modelId 与显示名同时匹配', () => {
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('搜索模型…'), { target: { value: 'glm' } })
    expect(screen.queryByText('GLM 5.2')).toBeTruthy()
    expect(screen.queryByText('Kimi K2.7 Code')).toBeNull()
  })

  /*
   * 组头是可点击的折叠开关。它曾是个裸 <button>（违反"原生控件只许出现在 primitives"），
   * 改用 UiOptionButton 后要保证行为没变：点一下收起该组的模型行，再点展开，
   * 且 aria-expanded 跟着变——组头本身始终可见。
   */
  it('点组头折叠该组，再点展开', () => {
    renderDialog()
    expect(screen.getByText('Kimi K2.7 Code')).toBeTruthy()

    const header = screen.getByText('moonshotai').closest('button')
    expect(header).toBeTruthy()
    expect(header?.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(header as HTMLElement)
    expect(screen.queryByText('Kimi K2.7 Code')).toBeNull()
    expect(screen.getByText('moonshotai')).toBeTruthy()
    expect(
      screen.getByText('moonshotai').closest('button')?.getAttribute('aria-expanded')
    ).toBe('false')

    fireEvent.click(screen.getByText('moonshotai').closest('button') as HTMLElement)
    expect(screen.getByText('Kimi K2.7 Code')).toBeTruthy()
  })

  it('折叠状态下组头的整组添加仍然可用', () => {
    const { onAdd } = renderDialog()
    fireEvent.click(screen.getByText('moonshotai').closest('button') as HTMLElement)

    fireEvent.click(screen.getByLabelText('添加 moonshotai 全部模型'))
    expect(onAdd).toHaveBeenCalledWith(['moonshotai/Kimi-K2.7-Code', 'moonshotai/Kimi-Linear'])
  })

  it('搜不到时给空态而不是空白', () => {
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText('搜索模型…'), { target: { value: '不存在的模型' } })
    expect(screen.getByText('没有匹配的模型')).toBeTruthy()
  })
})

