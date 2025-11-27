/**
 * 供应商适配器模板
 * 
 * 使用说明:
 * 1. 复制整个 _template 文件夹到新的供应商目录
 * 2. 修改 config.ts 中的配置
 * 3. 在 models/ 中添加模型路由
 * 4. 在 parsers/ 中调整响应解析器
 * 5. 如果支持异步任务,调整 statusManager.ts
 * 6. 在 adapters/index.ts 中注册此适配器
 */

import axios, { AxiosInstance } from 'axios'
import {
    BaseAdapter,
    GenerateImageParams,
    GenerateVideoParams,
    GenerateAudioParams,
    ImageResult,
    VideoResult,
    AudioResult,
    TaskStatus
} from '../base/BaseAdapter'
import { CONFIG } from './config'
import { findRoute } from './models'
import * as parsers from './parsers'
import { StatusManager } from './statusManager'

/**
 * [供应商名称] 适配器
 */
export class ProviderAdapter extends BaseAdapter {
    private apiClient: AxiosInstance
    private statusManager: StatusManager

    constructor(apiKey: string) {
        super(CONFIG.PROVIDER_NAME)

        // 初始化API客户端
        this.apiClient = axios.create({
            baseURL: CONFIG.BASE_URL,
            headers: this.buildHeaders(apiKey),
            timeout: CONFIG.REQUEST_TIMEOUT
        })

        // 初始化状态管理器
        this.statusManager = new StatusManager(this.apiClient, this)
    }

    /**
     * 构建请求头
     */
    private buildHeaders(apiKey: string) {
        if (CONFIG.AUTH_TYPE === 'bearer') {
            return {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        } else {
            return {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey
            }
        }
    }

    /**
     * 生成图片
     */
    async generateImage(params: GenerateImageParams): Promise<ImageResult> {
        try {
            // 1. 查找路由
            const route = findRoute(params.model)
            if (!route) {
                throw new Error(`Unsupported model: ${params.model}`)
            }

            // 2. 构建请求
            const { endpoint, requestData } = route.buildRequest(params)
            this.log('生成图片请求:', { endpoint, model: params.model })

            // 3. 发送请求
            const response = await this.apiClient.post(endpoint, requestData)

            // 4. 解析响应
            if (route.parseResponse) {
                return route.parseResponse(response.data)
            }
            return parsers.imageParser.parse(response.data, this)

        } catch (error) {
            this.log('生成图片失败:', error)
            throw this.formatError(error)
        }
    }

    /**
     * 生成视频
     */
    async generateVideo(params: GenerateVideoParams): Promise<VideoResult> {
        try {
            const route = findRoute(params.model)
            if (!route) {
                throw new Error(`Unsupported model: ${params.model}`)
            }

            const { endpoint, requestData } = route.buildRequest(params)
            this.log('生成视频请求:', { endpoint, model: params.model })

            const response = await this.apiClient.post(endpoint, requestData)

            // 检查是否返回任务ID(异步)
            const taskId = this.extractTaskId(response.data)
            if (taskId && params.onProgress) {
                this.log('检测到异步任务,开始轮询:', taskId)
                return await this.statusManager.pollUntilComplete(
                    taskId,
                    params.model,
                    params.onProgress
                )
            }

            // 同步返回
            if (route.parseResponse) {
                return route.parseResponse(response.data)
            }
            return parsers.videoParser.parse(response.data, this)

        } catch (error) {
            this.log('生成视频失败:', error)
            throw this.formatError(error)
        }
    }

    /**
     * 生成音频
     */
    async generateAudio(params: GenerateAudioParams): Promise<AudioResult> {
        try {
            const route = findRoute(params.model)
            if (!route) {
                throw new Error(`Unsupported model: ${params.model}`)
            }

            const { endpoint, requestData } = route.buildRequest(params)
            this.log('生成音频请求:', { endpoint, model: params.model })

            const response = await this.apiClient.post(endpoint, requestData)

            if (route.parseResponse) {
                return route.parseResponse(response.data)
            }
            return parsers.audioParser.parse(response.data, this)

        } catch (error) {
            this.log('生成音频失败:', error)
            throw this.formatError(error)
        }
    }

    /**
     * 检查任务状态
     */
    async checkStatus(taskId: string): Promise<TaskStatus> {
        return this.statusManager.checkStatus(taskId)
    }

    /**
     * 从响应中提取任务ID
     * 不同供应商的字段名可能不同,在这里统一处理
     */
    private extractTaskId(responseData: any): string | undefined {
        // 常见的任务ID字段名
        return responseData.task_id ||
            responseData.request_id ||
            responseData.id ||
            responseData.job_id
    }
}
