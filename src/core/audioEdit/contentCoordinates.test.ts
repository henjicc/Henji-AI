import { describe, expect, it } from 'vitest'
import { alignToScript } from './contentCoordinates'

describe('对稿', () => {
  it('念坏了往回重念：回跳处标出来，前一遍多说的字不算在稿子上', () => {
    const script = [...'今天我们来聊一个新工具它叫知多少']
    const spoken = [...'今天我们来聊一个东西', ...'今天我们来聊一个新工具它叫知多少']
    const { position, jumpBefore } = alignToScript(spoken, script)
    expect([...jumpBefore].map((flag, index) => (flag ? index : -1)).filter((index) => index >= 0)).toEqual([10])
    expect([...position.slice(8, 10)]).toEqual([-1, -1])
    expect([...position.slice(10)]).toEqual(script.map((_, index) => index))
  })

  const longScript = Array.from({ length: 6000 }, (_, index) => `u${index % 997}-${Math.floor(index / 7)}`)

  it('重念正好从一块的开头之后起：照样标出回跳', () => {
    // 每块确定 1000 个字；第 1002 个字起往回 12 个字重念
    const spoken = [...longScript.slice(0, 1002), ...longScript.slice(990, 2400)]
    const { position, jumpBefore } = alignToScript(spoken, longScript)
    expect([...jumpBefore].map((flag, index) => (flag ? index : -1)).filter((index) => index >= 0)).toEqual([1002])
    expect(position[1002]).toBe(990)
    expect(position[spoken.length - 1]).toBe(2399)
  })

  it('跳过稿子一大段、稿子只念了后半：重新找到位置，不会从此对不上', () => {
    const skipped = [...longScript.slice(0, 500), ...longScript.slice(3500, 5200)]
    const after = alignToScript(skipped, longScript).position
    expect(after[499]).toBe(499)
    expect(after[1600]).toBe(3500 + 1100)
    expect([...after.slice(500)].filter((value) => value < 0).length).toBeLessThan(20)
    const tail = alignToScript(longScript.slice(4000), longScript).position
    expect(tail[0]).toBe(4000)
    expect(tail[1999]).toBe(5999)
  })

  it('先说一大段稿子里没有的话，再跳到稿子后面：稿外的话过去之后照样找回位置', () => {
    const adlib = Array.from({ length: 400 }, (_, index) => `x${index}`)
    const spoken = [...longScript.slice(0, 300), ...adlib, ...longScript.slice(2500, 4000)]
    const { position } = alignToScript(spoken, longScript)
    expect(position[299]).toBe(299)
    expect([...position.slice(300, 700)].every((value) => value < 0)).toBe(true)
    expect([...position.slice(700)].filter((value) => value < 0).length).toBeLessThan(20)
    expect(position[spoken.length - 1]).toBe(3999)
  })

  it('长录音分块对齐，结果与稿子位置一致', () => {
    const script = Array.from({ length: 4000 }, (_, index) => `u${index % 997}-${Math.floor(index / 7)}`)
    const { position, jumpBefore } = alignToScript(script, script)
    expect([...position]).toEqual(script.map((_, index) => index))
    expect(jumpBefore.some(Boolean)).toBe(false)
  })
})
