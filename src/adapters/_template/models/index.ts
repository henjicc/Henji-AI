/**
 * 模型路由注册中心
 * 
 * 使用说明:
 * 1. 导入所有模型路由
 * 2. 添加到 routes 数组
 * 3. findRoute 函数会自动查找匹配的路由
 */

import { ModelRoute } from '../types'
import { exampleModelRoute } from './exampleModel'
// import { anotherModelRoute } from './anotherModel'  // 添加更多模型

/**
 * 所有模型路由列表
 */
export const routes: ModelRoute[] = [
    exampleModelRoute,
    // anotherModelRoute,  // 添加更多路由
]

/**
 * 查找匹配的模型路由
 * @param modelId 模型ID
 * @returns 匹配的路由,如果没找到返回 undefined
 */
export const findRoute = (modelId: string): ModelRoute | undefined => {
    return routes.find(route => route.matches(modelId))
}
