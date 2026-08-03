import { describe, expect, it } from 'vitest'

import {
  getApplicationControlExecutionEngine,
  getApplicationReflectionRegistry,
} from './applicationControlRegistry'

/**
 * 反射注册表是惰性构建的，只有第一次真正执行写入类能力时才会跑一遍全部
 * `register()`。任何一条注册项的 schema id、版本或重复 ID 有问题，都要到那一刻才炸，
 * 而且炸在用户的任务中途——实测就是这样：三维摆放一直失败，错误是注册表构建时的
 * ZodError，跟模型传的参数毫无关系。
 *
 * 这个用例把"能不能建起来"提前到单元测试，让注册项的问题在合并前就暴露。
 */
describe('应用反射注册表', () => {
  it('全部领域注册项都能注册成功', () => {
    expect(() => getApplicationReflectionRegistry()).not.toThrow()
  })

  it('执行引擎能在注册表之上建起来', () => {
    expect(() => getApplicationControlExecutionEngine()).not.toThrow()
  })
})
