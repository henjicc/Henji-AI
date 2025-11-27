/**
 * 供应商适配器类型定义
 */

import { GenerateImageParams, GenerateVideoParams, GenerateAudioParams } from '../base/BaseAdapter'

/**
 * 模型路由接口
 * 每个模型对应一个路由,负责构建该模型的API请求
 */
export interface ModelRoute {
    /**
     * 判断是否匹配该模型
     * @param modelId 模型ID
     * @returns 是否匹配
     */
    matches(modelId: string): boolean

    /**
     * 构建API请求
     * @param params 生成参数
     * @returns 端点和请求数据
     */
    buildRequest(params: GenerateImageParams | GenerateVideoParams | GenerateAudioParams): {
        endpoint: string
        requestData: any
    }

    /**
     * 可选: 自定义响应处理
     * 如果不提供,使用默认解析器
     */
    parseResponse?(response: any): any
}

/**
 * 响应解析器接口
 */
export interface ResponseParser<T> {
    /**
     * 解析API响应
     * @param responseData API响应数据
     * @param adapter 适配器实例 (用于调用通用方法如saveMediaLocally)
     * @returns 解析后的结果
     */
    parse(responseData: any, adapter: any): Promise<T>
}
