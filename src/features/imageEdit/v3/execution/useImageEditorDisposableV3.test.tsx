/** @vitest-environment jsdom */

import { StrictMode, type PropsWithChildren } from 'react'
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useImageEditorDisposableV3 } from './useImageEditorDisposableV3'

function StrictModeWrapper({ children }: PropsWithChildren): JSX.Element {
  return <StrictMode>{children}</StrictMode>
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('useImageEditorDisposableV3', () => {
  it('StrictMode 生命周期重放不会释放仍在使用的客户端，真实卸载只释放一次', async () => {
    const resource = { dispose: vi.fn() }
    const rendered = renderHook(
      () => useImageEditorDisposableV3(resource),
      { wrapper: StrictModeWrapper },
    )

    await flushMicrotasks()
    expect(resource.dispose).not.toHaveBeenCalled()

    rendered.unmount()
    await flushMicrotasks()
    expect(resource.dispose).toHaveBeenCalledTimes(1)
  })

  it('资源实例变化后释放旧实例，不误伤新实例', async () => {
    const first = { dispose: vi.fn() }
    const second = { dispose: vi.fn() }
    const rendered = renderHook(
      ({ resource }) => useImageEditorDisposableV3(resource),
      { initialProps: { resource: first } },
    )

    rendered.rerender({ resource: second })
    await flushMicrotasks()
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).not.toHaveBeenCalled()

    rendered.unmount()
    await flushMicrotasks()
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })
})
