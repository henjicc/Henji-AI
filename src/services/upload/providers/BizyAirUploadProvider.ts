import OSS from 'ali-oss'
import { UploadProvider } from './BaseUploadProvider'
import { logInfo, logError } from '../../../utils/errorLogger'
import { getExtensionFromMimeType, getMimeTypeFromDataURI } from '../../../utils/fileUtils'

export class BizyAirUploadProvider implements UploadProvider {
    readonly name = 'BizyAir'

    constructor() { }

    isAvailable(): boolean {
        const key = localStorage.getItem('bizyair_api_key')
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
            const apiKey = localStorage.getItem('bizyair_api_key')
            if (!apiKey) {
                throw new Error('BizyAir API key not found')
            }

            // 处理文件
            let fileToUpload: File | Blob = file as any
            let detectedMime = 'image/jpeg'

            if (typeof file === 'string') {
                if (file.startsWith('http')) {
                    // BizyAir 可能不支持直接传 URL
                    return file
                }
                if (file.startsWith('data:')) {
                    const extractedMime = getMimeTypeFromDataURI(file)
                    if (extractedMime) detectedMime = extractedMime
                    fileToUpload = this.dataURItoBlob(file)
                } else {
                    // 假设是 base64 image/jpeg
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
                // 可选：如果不匹配，尝试修复或仅记录警告？
                // 这里为了简单，如果是默认模式的命名（可能没有后缀或者后缀不对），我们尝试附加
                // 但如果用户明确传了 filename，通常应该尊重用户的 filename
                // 不过这里是为了解决 "mp4 被存成 .jpg" 的问题
                // 如果 filename 显式以 .jpg 结尾但内容是 mp4，替换它
                if (filename.toLowerCase().endsWith('.jpg') && detectedExt === '.mp4') {
                    filename = filename.replace(/\.jpg$/i, '.mp4')
                } else if (filename.toLowerCase().endsWith('.jpeg') && detectedExt === '.mp4') {
                    filename = filename.replace(/\.jpeg$/i, '.mp4')
                }
            }

            // 确保 fileToUpload 是 Blob/File 类型，并且有 size
            const fileSize = fileToUpload.size
            if (!fileSize) {
                throw new Error('File size is 0 or undefined')
            }


            logInfo('[BizyAirUploadProvider]', { message: '开始上传流程...', filename, size: fileSize, type: detectedMime })

            const authHeader = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`

            // 步骤一：获取上传凭证
            const tokenUrl = new URL('https://api.bizyair.cn/x/v1/upload/token')
            tokenUrl.searchParams.append('file_name', filename)
            tokenUrl.searchParams.append('file_type', 'inputs')

            logInfo('[BizyAirUploadProvider]', '获取凭证...')
            const tokenRes = await fetch(tokenUrl.toString(), {
                method: 'GET',
                headers: { 'Authorization': authHeader }
            })

            if (!tokenRes.ok) {
                const errorText = await tokenRes.text()
                throw new Error(`BizyAir 获取凭证失败: ${tokenRes.status} ${errorText}`)
            }

            const tokenData = await tokenRes.json()
            if (!tokenData.status) {
                throw new Error(`BizyAir API 错误: ${tokenData.message}`)
            }

            const { file: fileInfo, storage } = tokenData.data

            // 步骤二：上传到 OSS
            logInfo('[BizyAirUploadProvider]', { message: '上传到 OSS...', endpoint: storage.endpoint, region: storage.region })

            // 注意：这里需要 ali-oss 库
            // 必须处理 region 前缀
            const region = storage.region.startsWith('oss-') ? storage.region : `oss-${storage.region}`

            const client = new OSS({
                region: region,
                endpoint: storage.endpoint, // 显式指定 endpoint
                accessKeyId: fileInfo.access_key_id,
                accessKeySecret: fileInfo.access_key_secret,
                stsToken: fileInfo.security_token,
                bucket: storage.bucket,
                secure: true
            })

            // 执行 OSS 上传
            // fileToUpload 可以是 Blob, File, 或者 Buffer
            // ali-oss 的 put 方法支持 Blob/File
            // object_key 是 OSS 上的路径
            await client.put(fileInfo.object_key, fileToUpload)

            // 步骤三：提交资源
            logInfo('[BizyAirUploadProvider]', '提交资源...')

            const commitRes = await fetch('https://api.bizyair.cn/x/v1/input_resource/commit', {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: filename,
                    object_key: fileInfo.object_key
                })
            })

            if (!commitRes.ok) {
                const errorText = await commitRes.text()
                throw new Error(`BizyAir 提交资源失败: ${commitRes.status} ${errorText}`)
            }

            const commitData = await commitRes.json()
            if (!commitData.status) {
                throw new Error(`BizyAir 提交失败: ${commitData.message}`)
            }

            const finalUrl = commitData.data.url
            logInfo('[BizyAirUploadProvider]', { message: '上传成功', url: finalUrl })

            return finalUrl

        } catch (error: any) {
            logError('[BizyAirUploadProvider] 上传失败:', error)
            // 重新抛出以便上层处理 (回退逻辑)
            throw error
        }
    }

    async uploadMultiple(files: (File | Blob | string)[]): Promise<string[]> {
        return Promise.all(files.map((f, i) => this.upload(f, `file_${Date.now()}_${i}.jpg`)))
    }
}
