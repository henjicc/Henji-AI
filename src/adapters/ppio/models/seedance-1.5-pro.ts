import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * Seedance 1.5 Pro 模型路由
 * 支持文生视频、图生视频、首尾帧
 */
export const seedance15ProRoute = {
    // 模型ID识别
    matches: (modelId: string) => modelId === 'seedance-v1.5-pro',

    // 构建视频生成请求
    buildVideoRequest: (params: GenerateVideoParams) => {
        const images = params.images || []
        const resolution = params.resolution || '720p'
        const duration = params.duration || 5
        const cameraFixed = params.cameraFixed || false
        const serviceTier = params.serviceTier || 'default'
        const generateAudio = params.generateAudio || false

        // 获取比例参数，如果是 smart 则使用 params.smartMatchedRatio
        let ratio = params.aspectRatio || '1:1'
        if (ratio === 'smart' && params.smartMatchedRatio) {
            ratio = params.smartMatchedRatio
        }

        let endpoint: string
        let requestData: any

        if (images.length > 0) {
            // 图生视频 / 首尾帧
            endpoint = '/async/seedance-v1.5-pro-i2v'
            requestData = {
                prompt: params.prompt,
                image: images[0],
                resolution,
                ratio,
                duration,
                camera_fixed: cameraFixed,
                service_tier: serviceTier,
                generate_audio: generateAudio
            }

            // 如果有两张图片，添加 last_image 参数（首尾帧模式）
            if (images.length >= 2) {
                requestData.last_image = images[1]
            }
        } else {
            // 文生视频
            endpoint = '/async/seedance-v1.5-pro-t2v'
            requestData = {
                prompt: params.prompt,
                resolution,
                ratio,
                duration,
                camera_fixed: cameraFixed,
                service_tier: serviceTier,
                generate_audio: generateAudio
            }
        }

        return { endpoint, requestData }
    }
}
