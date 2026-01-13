/**
 * 根据 MIME 类型获取对应的文件扩展名
 * @param mimeType MIME 类型字符串，如 'image/jpeg', 'video/mp4'
 * @returns 对应的扩展名（带点），如 '.jpg', '.mp4'。如果无法识别，返回默认的 '.bin' 或尝试从 mime 中提取
 */
export function getExtensionFromMimeType(mimeType: string): string {
    if (!mimeType) return '.jpg' // 默认回退到 jpg

    const mime = mimeType.toLowerCase()

    // 常见图片格式
    if (mime.includes('image/jpeg') || mime.includes('image/jpg')) return '.jpg'
    if (mime.includes('image/png')) return '.png'
    if (mime.includes('image/webp')) return '.webp'
    if (mime.includes('image/gif')) return '.gif'
    if (mime.includes('image/svg')) return '.svg'
    if (mime.includes('image/bmp')) return '.bmp'
    if (mime.includes('image/tiff')) return '.tiff'

    // 常见视频格式
    if (mime.includes('video/mp4')) return '.mp4'
    if (mime.includes('video/webm')) return '.webm'
    if (mime.includes('video/quicktime')) return '.mov'
    if (mime.includes('video/x-msvideo')) return '.avi'
    if (mime.includes('video/mpeg')) return '.mpeg'
    if (mime.includes('video/3gpp')) return '.3gp'
    if (mime.includes('video/x-matroska')) return '.mkv'

    // 常见音频格式
    if (mime.includes('audio/mpeg')) return '.mp3'
    if (mime.includes('audio/wav')) return '.wav'
    if (mime.includes('audio/aac')) return '.aac'
    if (mime.includes('audio/ogg')) return '.ogg'
    if (mime.includes('audio/midi')) return '.midi'
    if (mime.includes('audio/x-m4a')) return '.m4a'

    // 尝试从 mime type 中提取子类型作为兜底
    // 例如 text/plain -> .plain (虽然不太对，但对于 image/xxx 比较有效)
    const parts = mime.split('/')
    if (parts.length === 2) {
        const subtype = parts[1].split(';')[0] // 去掉可能存在的参数
        if (/^[a-z0-9]+$/i.test(subtype)) {
            return `.${subtype}`
        }
    }

    return '.jpg' // 最终兜底
}

/**
 * 从 Data URI 或 文件名中提取 MIME 类型
 */
export function getMimeTypeFromDataURI(dataUri: string): string | null {
    const match = dataUri.match(/^data:(.*?);/)
    return match ? match[1] : null
}
