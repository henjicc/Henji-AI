/** @vitest-environment jsdom */

import { StrictMode } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useImageEditorResultLeaseV3 } from './useImageEditorResultLeaseV3'

describe('图片编辑 V3 React 成品租约', () => {
  it('StrictMode 临时 cleanup 不释放仍在使用的结果，真实卸载只释放一次', async () => {
    const result = { release: vi.fn() }
    const rendered = renderHook(
      ({ value }) => useImageEditorResultLeaseV3(value),
      {
        initialProps: { value: result },
        wrapper: StrictMode,
      },
    )

    await Promise.resolve()
    expect(result.release).not.toHaveBeenCalled()

    rendered.unmount()
    await Promise.resolve()
    expect(result.release).toHaveBeenCalledTimes(1)
  })

  it('新结果完成 commit 后释放旧结果，并在卸载时释放当前结果', async () => {
    const first = { release: vi.fn() }
    const second = { release: vi.fn() }
    const rendered = renderHook(
      ({ value }) => useImageEditorResultLeaseV3(value),
      { initialProps: { value: first } },
    )

    rendered.rerender({ value: second })
    expect(first.release).not.toHaveBeenCalled()
    await Promise.resolve()
    expect(first.release).toHaveBeenCalledTimes(1)
    expect(second.release).not.toHaveBeenCalled()

    rendered.unmount()
    await Promise.resolve()
    expect(second.release).toHaveBeenCalledTimes(1)
  })
})
