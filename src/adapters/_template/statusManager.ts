/**
 * 状态管理器模板
 * 
 * 使用说明:
 * 1. 如果API不支持异步任务,可以删除此文件
 * 2. 根据API的状态查询方式调整 checkStatus
 * 3. 如果有自定义的轮询逻辑,调整 pollUntilComplete
 */

import { AxiosInstance } from 'axios'
import { TaskStatus, ProgressStatus } from '../base/BaseAdapter'
import { pollUntilComplete } from '@/utils/polling'
import { getExpectedPolls } from '@/utils/modelConfig'
import { CONFIG } from './config'
import * as parsers from './parsers'

export class StatusManager {
    constructor(
        private apiClient: AxiosInstance,
        private adapter: any
    ) { }

    /**
     * 查询任务状态
     * @param taskId 任务ID
     * @returns 任务状态
     */
    async checkStatus(taskId: string): Promise<TaskStatus> {
        try {
            // 根据实际API调整请求方式
            const response = await this.apiClient.get(CONFIG.STATUS_ENDPOINT, {
                params: { task_id: taskId }  // 或 request_id,根据实际情况
            })

            const data = response.data

            // 构建标准的TaskStatus对象
            const result: TaskStatus = {
                taskId: data.task_id || data.id,
                status: data.status
            }

            // 如果任务完成,解析结果
            if (data.status === 'COMPLETED' || data.status === 'SUCCESS') {
                // 根据返回的数据类型选择解析器
                if (data.images || data.image_url) {
                    result.result = await parsers.imageParser.parse(data, this.adapter)
                } else if (data.videos || data.video_url) {
                    result.result = await parsers.videoParser.parse(data, this.adapter)
                } else if (data.audios || data.audio_url) {
                    result.result = await parsers.audioParser.parse(data, this.adapter)
                }
            }

            // 添加进度信息(如果API提供)
            if (data.progress !== undefined) {
                result.progress = data.progress
            }

            return result

        } catch (error) {
            this.adapter.log('状态查询失败:', error)
            throw this.adapter.formatError(error)
        }
    }

    /**
     * 轮询任务直到完成
     * @param taskId 任务ID
     * @param modelId 模型ID
     * @param onProgress 进度回调
     * @returns 最终结果
     */
    async pollUntilComplete(
        taskId: string,
        modelId: string,
        onProgress?: (status: ProgressStatus) => void
    ): Promise<any> {
        const expectedPolls = getExpectedPolls(modelId)

        this.adapter.log('开始轮询任务:', { taskId, modelId, expectedPolls })

        const result = await pollUntilComplete({
            checkFn: async () => {
                const status = await this.checkStatus(taskId)
                return {
                    status: status.status,
                    result: status.result
                }
            },
            // 根据实际API的状态码调整
            isComplete: (status) => status === 'COMPLETED' || status === 'SUCCESS',
            isFailed: (status) => status === 'FAILED' || status === 'ERROR',
            onProgress: (progress, status) => {
                if (onProgress) {
                    let message = '生成中...'
                    if (status === 'QUEUED' || status === 'IN_QUEUE') {
                        message = '排队中...'
                    } else if (status === 'PROCESSING' || status === 'IN_PROGRESS') {
                        message = '正在生成...'
                    }

                    onProgress({
                        status: status as any,
                        progress,
                        message
                    })
                }
            },
            interval: CONFIG.POLL_INTERVAL,
            maxAttempts: CONFIG.MAX_POLL_ATTEMPTS,
            estimatedAttempts: expectedPolls
        })

        return result
    }
}
