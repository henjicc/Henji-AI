import { GenerateVideoParams } from '@/adapters/base/BaseAdapter'

/**
 * PPIO Kling 2.6 Pro 模型路由
 * 支持 3 种端点：文生视频、图生视频、动作控制
 */
export const kling26ProRoute = {
    matches: (modelId: string): modelId is 'kling-2.6-pro' => modelId === 'kling-2.6-pro',

    buildVideoRequest: async (params: GenerateVideoParams): Promise<{ endpoint: string; requestData: any }> => {
        const mode = (params.mode as string) || 'text-image-to-video'
        const images = params.images || []
        const video = params.video
        const duration = params.duration || 5
        const aspectRatio = params.aspectRatio || '16:9'
        const cfgScale = params.cfgScale
        const sound = params.sound !== undefined ? params.sound : false
        const characterOrientation = params.characterOrientation || 'video'
        const keepOriginalSound = params.keepOriginalSound !== undefined ? params.keepOriginalSound : true
        const prompt = (params.prompt || '').slice(0, 2500)

        if (!prompt || prompt.trim() === '') {
            throw new Error('视频生成需要提供非空的 prompt')
        }

        let endpoint: string
        let requestData: any = {
            prompt
        }

        // 动作控制模式
        if (mode === 'motion-control') {
            if (!video) {
                throw new Error('动作控制模式需要上传视频')
            }
            if (images.length === 0) {
                throw new Error('动作控制模式需要上传图片')
            }

            // 上传视频到 Fal CDN
            const videoUrl = await uploadToFalAndGetUrl(video)

            // 上传图片到 Fal CDN
            const imageUrl = await uploadToFalAndGetUrl(images[0])

            endpoint = '/async/kling-v2.6-pro-motion-control'
            requestData.video = videoUrl
            requestData.image = imageUrl
            requestData.character_orientation = characterOrientation
            requestData.keep_original_sound = keepOriginalSound
        } else {
            // 文/图生视频模式
            requestData.duration = duration
            requestData.sound = sound

            if (cfgScale !== undefined) {
                requestData.cfg_scale = cfgScale
            }

            if (images.length > 0) {
                // 图生视频
                endpoint = '/async/kling-v2.6-pro-i2v'
                requestData.image = images[0]
                requestData.aspect_ratio = aspectRatio
            } else {
                // 文生视频
                endpoint = '/async/kling-v2.6-pro-t2v'
                requestData.aspect_ratio = aspectRatio
            }
        }

        return { endpoint, requestData }
    }
}

/**
 * 上传文件（视频或图片）到 Fal CDN
 * 支持 File 对象或 Data URI 字符串
 */
async function uploadToFalAndGetUrl(file: File | string): Promise<string> {
    // 如果是字符串且不是 Data URI，认为是 URL，直接返回
    if (typeof file === 'string' && !file.startsWith('data:')) {
        return file
    }

    try {
        let base64: string
        if (file instanceof File) {
            base64 = await fileToBase64(file)
        } else {
            base64 = file // 已经是 Data URI
        }

        // 获取 Fal API Key
        const falApiKey = localStorage.getItem('fal_api_key')
        if (!falApiKey) {
            throw new Error('未配置 Fal API Key，无法上传文件')
        }

        // 上传到 Fal CDN
        const { uploadToFalCDN } = await import('@/utils/falUpload')
        const url = await uploadToFalCDN(base64, falApiKey)

        return url
    } catch (error) {
        throw new Error(`文件上传失败: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/**
 * 将 File 对象转换为 base64 字符串
 */
function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            resolve(result)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}
