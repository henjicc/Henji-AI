import axios from 'axios'
import { UploadProvider } from './BaseUploadProvider'
import { logInfo, logError } from '../../../utils/errorLogger'
import { getExtensionFromMimeType, getMimeTypeFromDataURI } from '../../../utils/fileUtils'

// 复用 KIE 配置逻辑 (根据提供的文档更新)
const KIE_CONFIG = {
    uploadBaseURL: 'https://kieai.redpandaai.co',
    fileUploadEndpoint: '/api/file-stream-upload'
}

export class KieUploadProvider implements UploadProvider {
    readonly name = 'KIE'

    constructor() { }

    isAvailable(): boolean {
        const key = localStorage.getItem('kie_api_key')
        return !!key && key.trim().length > 0
    }

    private dataURItoBlob(dataUri: string): Blob {
        const arr = dataUri.split(',')
        const mimeMatch = arr[0].match(/:(.*?);/)
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
        const bstr = atob(arr[1])
        let n = bstr.length
        const u8arr = new Uint8Array(n)

        while (n--) {
            u8arr[n] = bstr.charCodeAt(n)
        }

        return new Blob([u8arr], { type: mime })
    }

    async upload(file: File | Blob | string, filename: string = 'file.jpg'): Promise<string> {
        try {
            const apiKey = localStorage.getItem('kie_api_key')
            if (!apiKey) {
                throw new Error('KIE API key not found')
            }

            // 处理文件
            let fileToUpload: File | Blob = file as any
            let detectedMime = 'image/jpeg'

            if (typeof file === 'string') {
                if (file.startsWith('http')) {
                    // 如果是URL，直接返回
                    return file
                }
                if (file.startsWith('data:')) {
                    const extractedMime = getMimeTypeFromDataURI(file)
                    if (extractedMime) detectedMime = extractedMime
                    fileToUpload = this.dataURItoBlob(file)
                } else {
                    fileToUpload = this.dataURItoBlob(`data:image/jpeg;base64,${file}`)
                }
            } else if (file instanceof Blob) {
                detectedMime = file.type
            }

            const detectedExt = getExtensionFromMimeType(detectedMime)

            // 如果 filename 是默认值 'file.jpg' 且检测到的后缀不匹配 (例如是 .mp4)，修正文件名
            if (filename === 'file.jpg' && detectedExt !== '.jpg') {
                filename = `file_${Date.now()}${detectedExt}`
            } else if (filename && !filename.endsWith(detectedExt)) {
                if (filename.toLowerCase().endsWith('.jpg') && detectedExt === '.mp4') {
                    filename = filename.replace(/\.jpg$/i, '.mp4')
                }
            }

            logInfo('[KieUploadProvider] 开始上传...', { filename, size: fileToUpload.size, type: detectedMime })

            const formData = new FormData()
            formData.append('file', fileToUpload, filename)
            formData.append('uploadPath', 'henji-uploads') // 使用固定的上传路径
            formData.append('fileName', filename) // 根据文档建议添加 fileName 字段

            const response = await axios.post(
                `${KIE_CONFIG.uploadBaseURL}${KIE_CONFIG.fileUploadEndpoint}`,
                formData,
                {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'multipart/form-data'
                    }
                }
            )

            logInfo('[KieUploadProvider] 上传响应:', response.data)

            if (response.data && response.data.data) {
                const fileUrl = response.data.data.fileUrl || response.data.data.downloadUrl
                if (fileUrl) {
                    return fileUrl
                }
            }

            throw new Error(`KIE Upload failed: ${JSON.stringify(response.data)}`)
        } catch (error: any) {
            logError('[KieUploadProvider] 上传失败:', error)
            if (error.response) {
                logError('[KieUploadProvider] 错误详情:', error.response.data)
            }
            throw error
        }
    }

    async uploadMultiple(files: (File | Blob | string)[]): Promise<string[]> {
        return Promise.all(files.map((f, i) => this.upload(f, `file_${i}.jpg`)))
    }
}
