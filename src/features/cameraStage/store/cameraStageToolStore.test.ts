import { describe, expect, it } from 'vitest'
import { createShot } from '../domain/shotTypes'
import { resolvePathShotId } from './cameraStageToolStore'

describe('路径工具默认过渡选择', () => {
  const shots = [
    createShot([], '关键帧 1', null, 0),
    createShot([], '关键帧 2', null, 2),
    createShot([], '关键帧 3', null, 5),
  ]

  it('播放头位于过渡中时直接选择对应路径', () => {
    expect(resolvePathShotId(shots, 3, shots[0].id)).toBe(shots[1].id)
  })

  it('播放头位于所选关键帧时优先选择该点之后的路径', () => {
    expect(resolvePathShotId(shots, 2, shots[1].id)).toBe(shots[1].id)
  })

  it('选中末尾关键帧时回退到最后一段路径', () => {
    expect(resolvePathShotId(shots, 6, shots[2].id)).toBe(shots[1].id)
  })
})
