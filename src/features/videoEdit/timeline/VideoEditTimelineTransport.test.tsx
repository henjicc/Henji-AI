// @vitest-environment jsdom
import React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { VideoEditInstance } from '../application/videoEditService'
import { TIMELINE_HEADER_WIDTH } from './timelineGeometry'
import { VideoEditTimelinePlayhead, VideoEditTimelinePlayheadHead } from './VideoEditTimelineTransport'

afterEach(cleanup)

it('标尺里播放头的头部与轨道里的竖线对齐，两段竖线不错开', () => {
  const pixels = 60 * 1.37 / 60
  const instance = { frame: 157 } as unknown as VideoEditInstance
  const { container } = render(<>
    <VideoEditTimelinePlayheadHead instance={instance} pixels={pixels} />
    <VideoEditTimelinePlayhead instance={instance} pixels={pixels} />
  </>)
  const head = container.querySelector<HTMLElement>('[data-video-edit-playhead-head]')!
  const line = container.querySelector<HTMLElement>('[data-video-edit-playhead]')!
  // 头宽 12（w-3），中线在 left + 6；轨道竖线从 left 起宽 1，中线在 left + 0.5（轨道坐标比标尺多出轨道头宽）
  const headCenter = parseFloat(head.style.left) + 6
  const lineCenter = parseFloat(line.style.left) - TIMELINE_HEADER_WIDTH + 0.5
  expect(head.className).toContain('w-3')
  expect(line.className).toContain('w-px')
  expect(headCenter).toBeCloseTo(lineCenter, 6)
})
