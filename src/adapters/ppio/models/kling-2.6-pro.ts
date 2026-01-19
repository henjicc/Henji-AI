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

            // 上传视频到通用上传服务
            const videoUrl = await uploadToGeneralService(video)

            // 图片直接使用（PPIOAdapter 已处理为 base64 或 public URL）
            // const imageUrl = await uploadToGeneralService(images[0])

            endpoint = '/async/kling-v2.6-pro-motion-control'
            requestData.video = videoUrl
            requestData.image = images[0]
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
 * 上传文件（视频或图片）到通用上传服务
 * 支持 File 对象或 Data URI 字符串
 */
async function uploadToGeneralService(file: File | string): Promise<string> {
    // 如果是字符串且不是 Data URI，认为是 URL，直接返回
    if (typeof file === 'string' && !file.startsWith('data:')) {
        return file
    }

    try {
        // 使用通用上传服务
        const { UploadService } = await import('@/services/upload/UploadService')
        const uploadService = UploadService.getInstance()

        // 如果是 File 对象，直接上传
        if (file instanceof File) {
            return await uploadService.uploadFile(file)
        }

        // 如果是 Data URI，转换为 Blob 后上传
        const blob = dataURItoBlob(file)
        return await uploadService.uploadFile(blob)
    } catch (error) {
        throw new Error(`文件上传失败: ${error instanceof Error ? error.message : String(error)}`)
    }
}

/**
 * 将 Data URI 转换为 Blob
 */
function dataURItoBlob(dataURI: string): Blob {
    const byteString = atob(dataURI.split(',')[1])
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0]
    const ab = new ArrayBuffer(byteString.length)
    const ia = new Uint8Array(ab)
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i)
    }
    return new Blob([ab], { type: mimeString })
}
