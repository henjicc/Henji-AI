// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest'

import { registry as modelRegistry } from '@/core/ModelRegistry'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

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
 * **必须先装真实模型再建注册表。** 这个用例原本不装，于是 `generation.model` 的
 * per-model schema 文档全是空的，注册表"能建起来"是假的：真实运行时里 ModelScope 的
 * `black-forest-labs/FLUX.1-Krea-dev` 带斜杠和大写，拼出来的 schema id 过不了稳定 id 正则，
 * 注册表整个建不起来。测试的洞正好是 bug 的形状。
 */
describe('应用反射注册表', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('测试装的是真实模型，不是空注册表', () => {
    // 守住上面那句「必须先装真实模型」——注册表一旦退化成空的，下面两条会重新变成假绿。
    expect(modelRegistry.listAllModels().length).toBeGreaterThan(10)
  })

  it('全部领域注册项都能注册成功', () => {
    expect(() => getApplicationReflectionRegistry()).not.toThrow()
  })

  it('执行引擎能在注册表之上建起来', () => {
    expect(() => getApplicationControlExecutionEngine()).not.toThrow()
  })
})
