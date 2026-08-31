/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UiErrorBoundary } from './UiErrorBoundary'

function Broken({ broken }: { broken: boolean }): JSX.Element {
  if (broken) throw new Error('detached bitmap')
  return <div>editor-ready</div>
}

describe('UiErrorBoundary', () => {
  it('支持局部自定义恢复并调用宿主重载', () => {
    const onReset = vi.fn()
    render(
      <UiErrorBoundary
        loggerDomain="test.image-editor"
        event="test.crashed"
        title="crashed"
        onReset={onReset}
        fallback={({ retry }) => <button onClick={retry}>reload-authoritative</button>}
      >
        <Broken broken />
      </UiErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'reload-authoritative' }))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('reset key 变化时自动清除旧错误', () => {
    const { rerender } = render(
      <UiErrorBoundary
        loggerDomain="test.image-editor"
        event="test.crashed"
        title="crashed"
        resetKeys={[0]}
        fallback={<div>local-fallback</div>}
      >
        <Broken broken />
      </UiErrorBoundary>,
    )
    expect(screen.getByText('local-fallback')).toBeTruthy()
    rerender(
      <UiErrorBoundary
        loggerDomain="test.image-editor"
        event="test.crashed"
        title="crashed"
        resetKeys={[1]}
        fallback={<div>local-fallback</div>}
      >
        <Broken broken={false} />
      </UiErrorBoundary>,
    )
    expect(screen.getByText('editor-ready')).toBeTruthy()
  })
})
