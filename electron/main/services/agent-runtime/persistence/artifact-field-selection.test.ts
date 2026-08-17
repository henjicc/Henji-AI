import { describe, expect, it } from 'vitest'

import { selectPayload } from './artifact-store'

/*
 * artifact-store.test.ts 里的用例只在 Electron 下运行（better-sqlite3 原生模块），
 * `npx vitest` 会整组跳过——字段筛选这段纯逻辑因此长期没有真正被守住。
 * 这个文件不碰数据库，专测那段逻辑，日常与 CI 都跑得到。
 *
 * 它守的是两次实测事故：
 * 1. 全有或全无——请求 12 个字段命中 11 个，只因 1 个不存在就整单拒绝，模型换一串继续猜，
 *    camera 场景在某个模型上重复 10 次直到运行被判死（46 轮、77 万 token、0 个 Effect）。
 * 2. 只认顶层键——模型写 `scriptApi.actions` 这种点路径要子树，四个全被判成不存在。
 */
const PAYLOAD = {
  scriptApi: { actions: ['place'], entities: { types: ['object'] } },
  capabilities: [{ name: 'a' }],
  note: 'hi',
  items: [{ id: 'x' }],
}

describe('artifact 字段筛选', () => {
  it('部分命中时返回命中的，缺失的如实回报', () => {
    const result = selectPayload(PAYLOAD, ['note', 'nope', 'capabilities'])
    expect(result.selectedFields).toEqual(['capabilities', 'note'])
    expect(result.missingFields).toEqual(['nope'])
    expect(result.payload).toEqual({ capabilities: PAYLOAD.capabilities, note: 'hi' })
  })

  it('点路径可以取到子树', () => {
    const result = selectPayload(PAYLOAD, ['scriptApi.actions', 'scriptApi.entities.types'])
    expect(result.missingFields).toEqual([])
    expect(result.payload).toEqual({
      'scriptApi.actions': ['place'],
      'scriptApi.entities.types': ['object'],
    })
  })

  it('点路径落空只算这一条缺失，不影响同批其他字段', () => {
    const result = selectPayload(PAYLOAD, ['scriptApi.nope', 'note'])
    expect(result.selectedFields).toEqual(['note'])
    expect(result.missingFields).toEqual(['scriptApi.nope'])
  })

  // 数组不是可继续下钻的对象；穿过去只会让"猜错"的面更大。
  it('路径穿不过数组时判未命中', () => {
    const result = selectPayload(PAYLOAD, ['items.id', 'note'])
    expect(result.selectedFields).toEqual(['note'])
    expect(result.missingFields).toEqual(['items.id'])
  })

  // 一个都没命中才报错：返回空对象会让模型以为 artifact 是空的。
  it('全部落空时报错并列出可用顶层字段', () => {
    expect(() => selectPayload(PAYLOAD, ['nope', 'alsoNope']))
      .toThrow(/不包含请求的任何顶层字段：alsoNope、nope。可用顶层字段：scriptApi、capabilities、note、items/)
  })

  /*
   * 字段确实存在、只是嵌套在里面时，必须把实际点路径说出来。
   *
   * 实测三维场景：模型写裸 `recipes`，被告知"可用顶层字段：…、scriptApi、…"——而 recipes
   * 就在 scriptApi 里面。运行时知道答案却只肯说"不在顶层"，模型于是原样再试一次，白烧两轮。
   */
  it('缺失字段其实是嵌套字段时，直接给出可用的点路径', () => {
    expect(() => selectPayload(PAYLOAD, ['actions']))
      .toThrow(/这些字段是嵌套的，改用点路径：actions → scriptApi\.actions/)
  })

  it('真的不存在的字段不编造路径', () => {
    expect(() => selectPayload(PAYLOAD, ['nope'])).not.toThrow(/改用点路径/)
  })

  it('不传 fields 时原样返回', () => {
    const result = selectPayload(PAYLOAD, undefined)
    expect(result.payload).toBe(PAYLOAD)
    expect(result.selectedFields).toEqual([])
    expect(result.missingFields).toEqual([])
  })

  it('顶层不是对象时拒绝筛选', () => {
    expect(() => selectPayload([1, 2, 3], ['a'])).toThrow(/只允许筛选 Artifact 顶层对象字段/)
  })
})
