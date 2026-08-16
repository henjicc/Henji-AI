import { describe, expect, it } from 'vitest'
import { createStateKeyframe } from '../domain/stateKeyframeTypes'
import { resolvePathStateKeyframeId } from './cameraStageToolStore'

describe('路径工具默认过渡选择', () => {
  const stateKeyframes = [
    createStateKeyframe([], '关键帧 1', null, 0),
    createStateKeyframe([], '关键帧 2', null, 2),
    createStateKeyframe([], '关键帧 3', null, 5),
  ]

  it('播放头位于过渡中时直接选择对应路径', () => {
    expect(resolvePathStateKeyframeId(stateKeyframes, 3, stateKeyframes[0].id)).toBe(stateKeyframes[1].id)
  })

  it('播放头位于所选关键帧时优先选择该点之后的路径', () => {
    expect(resolvePathStateKeyframeId(stateKeyframes, 2, stateKeyframes[1].id)).toBe(stateKeyframes[1].id)
  })

  it('选中末尾关键帧时回退到最后一段路径', () => {
    expect(resolvePathStateKeyframeId(stateKeyframes, 6, stateKeyframes[2].id)).toBe(stateKeyframes[1].id)
  })
})
