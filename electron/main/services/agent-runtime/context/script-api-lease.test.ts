import { describe, expect, it } from 'vitest'

import {
  clearHenjiScriptApiLease,
  getHenjiScriptApiLease,
  inheritHenjiScriptApiLease,
  rememberHenjiScriptApiLease,
} from './script-api-lease'

function projection() {
  return {
    actions: [{ id: 'create_visible_generation_task' }],
    recipes: [{ id: 'generation.image_to_canvas' }],
    entities: {
      entityTypes: ['canvas.project', 'canvas.node'],
      propertyIds: ['canvas.node.position'],
      propertyDefinitions: [{ id: 'canvas.node.position' }],
    },
    forbiddenEffects: [],
  } as unknown as Parameters<typeof rememberHenjiScriptApiLease>[1]
}

/*
 * 外部等待续跑换的是 runId，不是任务。租约记在父运行名下，续跑就再也写不出脚本——
 * 实测生成场景 8 项真实写入因此没能封存。
 */
describe('scriptApi 租约的续跑继承', () => {
  it('续跑运行继承父运行的租约', () => {
    rememberHenjiScriptApiLease('run-parent', projection())
    inheritHenjiScriptApiLease('run-parent', 'run-child')

    const lease = getHenjiScriptApiLease('run-child')
    expect(lease?.recipes.has('generation.image_to_canvas')).toBe(true)
    expect(lease?.entityTypes.has('canvas.project')).toBe(true)
    expect(lease?.propertyIds.has('canvas.node.position')).toBe(true)

    clearHenjiScriptApiLease('run-parent')
    clearHenjiScriptApiLease('run-child')
  })

  it('父运行没有租约时不伪造一个空租约', () => {
    inheritHenjiScriptApiLease('run-never-existed', 'run-child-2')
    expect(getHenjiScriptApiLease('run-child-2')).toBeNull()
  })
})
