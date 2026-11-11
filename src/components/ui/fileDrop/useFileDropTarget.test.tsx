// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HENJI_DRAG_DATA_MIME } from '@/contexts/dragDataTransfer'
import { useFileDropTarget, type FileDropTargetOptions } from './useFileDropTarget'

vi.mock('@/platform/desktopApi', () => ({ getPathForFile: (file: File) => `C:/drop/${file.name}` }))
afterEach(cleanup)

function Zone(props: FileDropTargetOptions): JSX.Element {
  const drop = useFileDropTarget(props)
  return <div data-testid="zone" data-over={drop.isDragOver} {...drop.dropProps} />
}

function transfer(files: File[], henji?: object): DataTransfer {
  const data = new Map<string, string>(henji ? [[HENJI_DRAG_DATA_MIME, JSON.stringify(henji)]] : [])
  return {
    files, types: [...(files.length ? ['Files'] : []), ...data.keys()],
    getData: (type: string) => data.get(type) ?? '', dropEffect: 'none',
  } as unknown as DataTransfer
}

describe('能上传的地方都能拖进来', () => {
  it('系统文件按格式过滤后交给同一个回调，只收一个时取第一个合格的', () => {
    const onDropFiles = vi.fn()
    render(<Zone accept={({ name }) => name.endsWith('.srt')} onDropFiles={onDropFiles} />)
    const files = [new File(['x'], 'a.txt'), new File(['x'], 'b.srt'), new File(['x'], 'c.srt')]
    fireEvent.drop(screen.getByTestId('zone'), { dataTransfer: transfer(files) })
    expect(onDropFiles).toHaveBeenCalledWith([{ file: files[1], name: 'b.srt', path: 'C:/drop/b.srt' }])
  })

  it('从资产库拖来的素材按本机路径收下；要 File 的入口不接', () => {
    const asset = { type: 'image', imageUrl: 'x', filePath: 'D:/assets/sky.png', sourceType: 'asset', assetId: 'a1' }
    const byPath = vi.fn()
    const { unmount } = render(<Zone onDropFiles={byPath} />)
    fireEvent.drop(screen.getByTestId('zone'), { dataTransfer: transfer([], asset) })
    expect(byPath).toHaveBeenCalledWith([{ path: 'D:/assets/sky.png', name: 'sky.png' }])
    unmount()

    const filesOnly = vi.fn()
    render(<Zone filesOnly onDropFiles={filesOnly} />)
    fireEvent.drop(screen.getByTestId('zone'), { dataTransfer: transfer([], asset) })
    expect(filesOnly).not.toHaveBeenCalled()
  })

  it('收不下的文件不拦：外层（如画布）照常接手', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(<div data-testid="outer" onDrop={outer}><Zone accept={({ name }) => name.endsWith('.png')} onDropFiles={inner} /></div>)
    fireEvent.drop(screen.getByTestId('zone'), { dataTransfer: transfer([new File(['x'], 'clip.mp4')]) })
    expect(inner).not.toHaveBeenCalled()
    expect(outer).toHaveBeenCalled()
  })

  it('拖着停在上面时高亮，离开或放下后取消；嵌套子元素进出不闪', () => {
    render(<Zone onDropFiles={vi.fn()} />)
    const zone = screen.getByTestId('zone')
    const files = transfer([new File(['x'], 'a.png')])
    fireEvent.dragEnter(zone, { dataTransfer: files })
    fireEvent.dragEnter(zone, { dataTransfer: files })
    fireEvent.dragLeave(zone, { dataTransfer: files })
    expect(zone.dataset.over).toBe('true')
    fireEvent.drop(zone, { dataTransfer: files })
    expect(zone.dataset.over).toBe('false')
  })
})
