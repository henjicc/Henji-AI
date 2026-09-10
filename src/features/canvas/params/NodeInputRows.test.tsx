// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NodeInputRows } from './NodeInputRows'

const limits = vi.hoisted(() => ({ images: { max: 1 }, videos: { max: 0 }, audios: { max: 0 } }))
vi.mock('@/core/inputs/inputLimits', () => ({ resolveInputLimits: () => limits }))
vi.mock('@/features/canvas/hooks/useNodeHandlesSync', () => ({ useNodeHandlesSync: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('./MediaInputRow', () => ({ MediaInputRow: () => <div data-testid="media-row" /> }))
vi.mock('./ModelInputRow', () => ({ ModelInputRow: () => null }))
vi.mock('./NodeParamRows', () => ({ NodeParamRows: () => null }))
afterEach(() => { cleanup(); limits.images.max = 1 })

const props: Parameters<typeof NodeInputRows>[0] = {
  nodeId: 'node', modelId: 'model', mediaType: 'image', acceptedMediaKinds: ['image'],
  externalMediaHandle: 'image', schema: [], values: {}, setParam: vi.fn(), setParams: vi.fn(),
  mediaInputs: {}, onMediaInputChange: vi.fn(), overrideModelId: null, storedParams: {},
  onModelChange: vi.fn(), onParamsChange: vi.fn(), incomingImages: ['source.png'],
}
describe('工作面单图输入不重复显示', () => {
  it('已有工作面时，连线和本地单图都隐藏参数行', () => {
    const view = render(<NodeInputRows {...props} />)
    expect(view.queryByTestId('media-row')).toBeNull()
    view.rerender(<NodeInputRows {...props} mediaInputs={{ image: ['source.png'] }} />)
    expect(view.queryByTestId('media-row')).toBeNull()
  })
  it('清空后恢复输入入口，普通节点有图也保留媒体行', () => {
    const view = render(<NodeInputRows {...props} incomingImages={[]} />)
    expect(view.queryByTestId('media-row')).not.toBeNull()
    view.rerender(<NodeInputRows {...props} externalMediaHandle={undefined} />)
    expect(view.queryByTestId('media-row')).not.toBeNull()
  })
  it('允许多图的节点不因已有一张图而隐藏列表，能力单图上限仍生效', () => {
    limits.images.max = 4
    const view = render(<NodeInputRows {...props} />)
    expect(view.queryByTestId('media-row')).not.toBeNull()
    view.rerender(<NodeInputRows {...props} maxMediaCounts={{ image: 1 }} />)
    expect(view.queryByTestId('media-row')).toBeNull()
    view.rerender(<NodeInputRows {...props} maxMediaCounts={{ image: 1 }} incomingImages={['a.png', 'b.png']} />)
    expect(view.queryByTestId('media-row')).not.toBeNull()
  })
})
