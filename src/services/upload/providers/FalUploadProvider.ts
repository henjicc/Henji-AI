import { fal } from '@fal-ai/client'
import { UploadProvider } from './BaseUploadProvider'
import { logInfo, logError } from '../../../utils/errorLogger'
import { getExtensionFromMimeType, getMimeTypeFromDataURI } from '../../../utils/fileUtils'

export class FalUploadProvider implements UploadProvider {
    readonly name = 'Fal'

    constructor() {
        // 构造函数中不做初始化，因为 key 可能会变
    }

    isAvailable(): boolean {
        const key = localStorage.getItem('fal_api_key')
        return !!key && key.trim().length > 0
    }

    private initFal() {
        const key = localStorage.getItem('fal_api_key')
        if (!key) {
            throw new Error('Fal API key not found')
        }
        fal.config({
            credentials: key
        })
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

    async upload(file: File | Blob | string, filename?: string): Promise<string> {
        try {
            this.initFal()

            let fileToUpload: File | Blob = file as any
            let detectedMime = 'image/jpeg'

            // 处理字符串 (URL 或 Base64)
            if (typeof file === 'string') {
                if (file.startsWith('http')) {
                    return file
                }
                if (file.startsWith('data:')) {
                    const extractedMime = getMimeTypeFromDataURI(file)
                    if (extractedMime) detectedMime = extractedMime
                    fileToUpload = this.dataURItoBlob(file)
                } else {
                    // 纯 Base64，假设为 jpeg
                    fileToUpload = this.dataURItoBlob(`data:image/jpeg;base64,${file}`)
                }
            } else if (file instanceof Blob) {
                detectedMime = file.type
            }

            const detectedExt = getExtensionFromMimeType(detectedMime)

            // 如果是 Blob 且没有文件名 (dataURI转换来的)，或者 filename 未提供，或者是默认名
            let finalFilename = filename || `file_${Date.now()}${detectedExt}`

            // 如果原来的 filename 后缀不对 (例如是 .jpg 但实际是 .mp4)，修正它
            if (filename) {
                if (filename.toLowerCase().endsWith('.jpg') && detectedExt !== '.jpg') {
                    finalFilename = filename.replace(/\.jpg$/i, detectedExt)
                } else if (filename.toLowerCase().endsWith('.jpeg') && detectedExt !== '.jpg') {
                    finalFilename = filename.replace(/\.jpeg$/i, detectedExt)
                }
            }

            // 为了让 fal SDK 也能拿到文件名 (如果有帮助的话)，可以将 Blob 转为 File
            if (fileToUpload instanceof Blob && !(fileToUpload instanceof File)) {
                fileToUpload = new File([fileToUpload], finalFilename, { type: detectedMime })
            } else if (fileToUpload instanceof File) {
                // 如果是 File，但后缀不对，或者我们想确保 type 正确
                if (finalFilename !== fileToUpload.name) {
                    fileToUpload = new File([fileToUpload], finalFilename, { type: fileToUpload.type || detectedMime })
                }
            }

            logInfo('[FalUploadProvider]', { message: '开始上传...', filename: finalFilename, type: detectedMime })
            const url = await fal.storage.upload(fileToUpload)
            logInfo('[FalUploadProvider]', { message: '上传成功', url })
            return url
        } catch (error) {
            logError('[FalUploadProvider] 上传失败:', error)
            throw error
        }
    }

    async uploadMultiple(files: (File | Blob | string)[]): Promise<string[]> {
        return Promise.all(files.map(f => this.upload(f)))
    }
}
