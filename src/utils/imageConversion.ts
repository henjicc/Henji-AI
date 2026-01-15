export async function dataUrlToFile(dataUrl: string, filename: string = 'image.jpg'): Promise<File> {
    // 直接转换 data URL 为 Blob（不使用 fetch，兼容 Tauri 生产环境）
    const parts = dataUrl.split(',')
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg'
    const bstr = atob(parts[1])
    let n = bstr.length
    const u8arr = new Uint8Array(n)
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
    }
    const blob = new Blob([u8arr], { type: mime })
    return new File([blob], filename, { type: mime })
}

export async function urlToFile(url: string, filename: string = 'image.jpg'): Promise<File> {
    // Handle both blob: and data: URLs
    if (url.startsWith('blob:') || url.startsWith('data:')) {
        return dataUrlToFile(url, filename)
    }

    // Handle file paths (convert to blob first)
    const response = await fetch(url)
    const blob = await response.blob()
    return new File([blob], filename, { type: blob.type || 'image/jpeg' })
}

export async function convertBlobToPng(blob: Blob): Promise<Blob> {
    if (blob.type === 'image/png') {
        return blob;
    }

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(blob);

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to get canvas context'));
                return;
            }
            ctx.drawImage(img, 0, 0);
            canvas.toBlob((pngBlob) => {
                URL.revokeObjectURL(url);
                if (pngBlob) {
                    resolve(pngBlob);
                } else {
                    reject(new Error('Failed to convert to PNG'));
                }
            }, 'image/png');
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for conversion'));
        };

        img.src = url;
    });
}

export function inferMimeFromPath(path: string): string {
    const lower = path.toLowerCase()
    if (lower.endsWith('.png')) return 'image/png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
    if (lower.endsWith('.webp')) return 'image/webp'
    if (lower.endsWith('.gif')) return 'image/gif'
    return 'image/jpeg'
}

/**
 * 从剪贴板事件中提取所有图片文件
 * 支持两种粘贴方式:
 * 1. 网页右击"复制图片" - clipboardData.items 包含 image blob
 * 2. 文件管理器复制图片文件 - clipboardData.items 包含 file 对象
 * 
 * @param e ClipboardEvent 对象
 * @returns Promise<File[]> 提取到的图片文件数组
 */
export async function extractImagesFromClipboard(e: ClipboardEvent): Promise<File[]> {
    const files: File[] = []
    const items = e.clipboardData?.items

    if (!items) {
        return files
    }

    // 遍历剪贴板项
    for (let i = 0; i < items.length; i++) {
        const item = items[i]

        // 方式1: 处理图片 blob (网页右击复制)
        if (item.type.startsWith('image/')) {
            const blob = item.getAsFile()
            if (blob) {
                // 确保是 File 对象,如果是 Blob 则转换
                if (blob instanceof File) {
                    files.push(blob)
                } else {
                    // Blob 转 File,生成时间戳文件名
                    const file = new File([blob], `pasted-image-${Date.now()}.${item.type.split('/')[1] || 'png'}`, {
                        type: item.type
                    })
                    files.push(file)
                }
            }
        }
        // 方式2: 处理文件对象 (文件管理器复制)
        else if (item.kind === 'file') {
            const file = item.getAsFile()
            if (file && file.type.startsWith('image/')) {
                files.push(file)
            }
        }
    }

    return files
}

/**
 * 生成缩略图并保存到临时文件
 * 用于拖拽时的图标显示
 * @param imageUrl 图片 URL
 * @returns 临时文件路径
 */
export async function generateThumbnail(imageUrl: string): Promise<string> {
    try {
        // 动态导入 Tauri API
        const { writeFile } = await import('@tauri-apps/plugin-fs')
        const { tempDir, join } = await import('@tauri-apps/api/path')

        // 1. 加载图片
        const img = new Image()
        img.crossOrigin = 'anonymous'
        await new Promise((resolve, reject) => {
            img.onload = resolve
            img.onerror = reject
            img.src = imageUrl
        })

        // 2. 计算缩放尺寸 (最大 100x100)
        const MAX_SIZE = 100
        let width = img.width
        let height = img.height

        if (width > height) {
            if (width > MAX_SIZE) {
                height = height * (MAX_SIZE / width)
                width = MAX_SIZE
            }
        } else {
            if (height > MAX_SIZE) {
                width = width * (MAX_SIZE / height)
                height = MAX_SIZE
            }
        }

        // 3. 绘制到 Canvas
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Failed to get canvas context')

        ctx.drawImage(img, 0, 0, width, height)

        // 4. 转换为 Blob -> Uint8Array
        const blob = await new Promise<Blob | null>(resolve =>
            canvas.toBlob(resolve, 'image/png')
        )
        if (!blob) throw new Error('Failed to create thumbnail blob')

        const arrayBuffer = await blob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        // 5. 保存到临时文件
        // 使用随机文件名避免冲突
        const tempPath = await tempDir()
        const fileName = `drag-thumb-${Date.now()}-${Math.floor(Math.random() * 1000)}.png`
        const filePath = await join(tempPath, fileName)

        await writeFile(filePath, uint8Array)

        return filePath
    } catch (error) {
        console.error('Failed to generate thumbnail:', error)
        // 如果失败，返回原始 URL (如果是本地路径) 或者空
        // 这里抛出错误，调用者可以降级处理
        throw error
    }
}
