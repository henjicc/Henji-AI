import { loadAllModels } from '@/core/loaders'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'

/**
 * 把仓库里**真实的**模型定义装进 ModelRegistry，供需要覆盖全量模型的用例使用。
 *
 * 之所以需要这个：模型是运行时由 `loadAllModels()` 扫进注册表的，单元测试里注册表默认是空
 * 的。于是"遍历全部模型"的代码路径在测试里全部退化成遍历空数组——反射注册表的用例一直是
 * 绿的，而实际运行时因为 ModelScope 的模型 id 带斜杠和大写，注册表根本建不起来。测试的洞
 * 正好是 bug 的形状。
 *
 * 必须走 `@/core/loaders` 这个真实入口，不能在这里自己写一遍 `import.meta.glob`：模型文件
 * 从 `@/core` 桶文件取 `sharedFieldText`，而桶文件又转导出 loaders，构成环。绕过真实入口
 * 会改变模块初始化顺序，环就会在测试里断开成 `sharedFieldText is not a function`。
 *
 * 用它的测试文件必须声明 `@vitest-environment jsdom`——modelLoader 在顶层往 `window` 上挂
 * 调试函数，Node 环境加载会直接崩。
 */
export async function loadRealModelsIntoRegistry(): Promise<ModelDefinition[]> {
  await loadAllModels()
  return registry.listAllModels()
}
