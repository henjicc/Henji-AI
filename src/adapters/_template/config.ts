/**
 * 供应商适配器配置模板
 * 
 * 使用说明:
 * 1. 将所有 'your-provider' 替换为实际的供应商ID
 * 2. 修改 BASE_URL 为实际的API地址
 * 3. 根据认证方式选择 AUTH_TYPE
 * 4. 如果支持异步任务,配置轮询相关参数
 */

export const CONFIG = {
    // 供应商标识
    PROVIDER_ID: 'your-provider',          // 修改为实际ID (如: 'openai', 'anthropic')
    PROVIDER_NAME: 'Your Provider Name',   // 修改为实际名称 (如: 'OpenAI')

    // API配置
    BASE_URL: 'https://api.example.com',   // 修改为实际API基础URL
    AUTH_TYPE: 'bearer' as const,          // 'bearer' 或 'apikey'

    // 状态查询配置 (如果API支持异步任务轮询)
    STATUS_ENDPOINT: '/task/status',       // 状态查询端点
    POLL_INTERVAL: 3000,                   // 轮询间隔(毫秒)
    MAX_POLL_ATTEMPTS: 120,                // 最大轮询次数

    // 超时配置
    REQUEST_TIMEOUT: 60000,                // 请求超时(毫秒)
}

// 类型定义
export type AuthType = typeof CONFIG.AUTH_TYPE
