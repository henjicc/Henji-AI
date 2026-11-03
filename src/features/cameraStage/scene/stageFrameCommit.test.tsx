// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import React, { useLayoutEffect } from 'react'
import { createRoot, type ReconcilerRoot } from '@react-three/fiber'
import { afterEach, expect, it } from 'vitest'
import { create } from 'zustand'
import { commitCameraStageFrame } from './stageFrameCommit'

/*
 * 导出逐帧 seek 后立即离屏抓图、不再等 RAF：store 改动必须在返回前同时提交到 DOM 渲染器里的
 * StageScene 和 R3F 渲染器里的场景对象，否则抓到的是上一帧。
 */

const useTime = create<{ time: number }>(() => ({ time: 0 }))
const committed = { time: -1 }

function SceneObject({ time }: { time: number }): null {
  useLayoutEffect(() => { committed.time = time }, [time])
  return null
}

// 模拟 Canvas：DOM 树里的父组件订阅 store，在布局 effect 里把新 props 交给 R3F 根。
function FakeCanvas({ root }: { root: ReconcilerRoot<HTMLCanvasElement> }): JSX.Element {
  const time = useTime((state) => state.time)
  useLayoutEffect(() => { root.render(<SceneObject time={time} />) })
  return <div />
}

const fakeRenderer = {
  render: () => undefined,
  setSize: () => undefined,
  setPixelRatio: () => undefined,
  shadowMap: {},
  xr: { enabled: false, addEventListener: () => undefined, removeEventListener: () => undefined, setAnimationLoop: () => undefined },
}

let root: ReconcilerRoot<HTMLCanvasElement> | null = null
afterEach(() => {
  cleanup()
  root?.unmount()
  root = null
})

it('seek 返回时三维场景已提交到新时间', async () => {
  root = createRoot(document.createElement('canvas'))
  root.configure({ gl: fakeRenderer as never, frameloop: 'never', size: { width: 10, height: 10, top: 0, left: 0 } })
  render(<FakeCanvas root={root} />)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  expect(committed.time).toBe(0)

  commitCameraStageFrame(() => useTime.setState({ time: 2 }))
  expect(committed.time).toBe(2)
})
