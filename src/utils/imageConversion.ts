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

/**
 * 从视频生成缩略图并保存到临时文件
 * 用于拖拽时的图标显示
 * @param videoUrl 视频 URL
 * @returns 临时文件路径
 */
export async function generateVideoThumbnail(videoUrl: string): Promise<string> {
    try {
        // 动态导入 Tauri API
        const { writeFile } = await import('@tauri-apps/plugin-fs')
        const { tempDir, join } = await import('@tauri-apps/api/path')

        // 1. 加载视频并截取第一帧
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.muted = true
        video.preload = 'metadata'

        await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve()
            video.onerror = () => reject(new Error('Failed to load video'))
            video.src = videoUrl
        })

        // 等待视频可播放
        await new Promise<void>((resolve) => {
            if (video.readyState >= 2) {
                resolve()
            } else {
                video.oncanplay = () => resolve()
            }
        })

        // 2. 计算缩放尺寸 (最大 100x100)
        const MAX_SIZE = 100
        let width = video.videoWidth
        let height = video.videoHeight

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

        ctx.drawImage(video, 0, 0, width, height)

        // 4. 转换为 Blob -> Uint8Array
        const blob = await new Promise<Blob | null>(resolve =>
            canvas.toBlob(resolve, 'image/png')
        )
        if (!blob) throw new Error('Failed to create video thumbnail blob')

        const arrayBuffer = await blob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        // 5. 保存到临时文件
        const tempPath = await tempDir()
        const fileName = `drag-video-thumb-${Date.now()}-${Math.floor(Math.random() * 1000)}.webp`
        const filePath = await join(tempPath, fileName)

        await writeFile(filePath, uint8Array)

        return filePath
    } catch (error) {
        console.error('Failed to generate video thumbnail:', error)
        throw error
    }
}

/**
 * 从视频生成预览用的 Data URL
 * 用于在 img 标签中显示（窗口内拖放预览）
 * @param videoUrl 视频 URL
 * @returns Base64 Data URL
 */
export async function generateVideoPreviewDataUrl(videoUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'

        // 超时保护
        const timeout = setTimeout(() => {
            reject(new Error('Video preview generation timeout'))
        }, 15000)

        // 实际截图逻辑
        const captureFrame = () => {
            try {
                clearTimeout(timeout)

                // 计算缩放尺寸 (最大 100x100)
                const MAX_SIZE = 100
                let width = video.videoWidth
                let height = video.videoHeight

                if (width === 0 || height === 0) {
                    reject(new Error('Video dimensions are zero'))
                    return
                }

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

                // 绘制到 Canvas
                const canvas = document.createElement('canvas')
                canvas.width = Math.floor(width)
                canvas.height = Math.floor(height)
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'))
                    return
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

                // 转换为 Data URL (WebP 更小)
                const dataUrl = canvas.toDataURL('image/webp', 0.8)
                resolve(dataUrl)
            } catch (err) {
                clearTimeout(timeout)
                reject(err)
            }
        }

        // 当视频元数据加载完成后，跳转到 0.1 秒处
        video.onloadedmetadata = () => {
            video.currentTime = 0.1
        }

        // 当视频跳转完成后（帧已准备好），截取图片
        video.onseeked = () => {
            captureFrame()
        }

        video.onerror = () => {
            clearTimeout(timeout)
            reject(new Error('Failed to load video'))
        }

        video.src = videoUrl
        video.load()
    })
}

// ==================== 视频缩略图缓存系统 ====================

/**
 * 根据视频文件路径生成对应的缩略图缓存路径
 * @param videoPath 视频文件路径
 * @returns 缩略图缓存路径
 */
export async function getVideoThumbnailCachePath(videoPath: string): Promise<string> {
    const { getThumbnailsPath } = await import('./dataPath')
    const { join, basename } = await import('@tauri-apps/api/path')

    const thumbnailsDir = await getThumbnailsPath()
    const videoName = await basename(videoPath)
    // 将扩展名改为 .webp（体积更小）
    const thumbName = videoName.replace(/\.[^.]+$/, '.webp')
    return await join(thumbnailsDir, thumbName)
}

/**
 * 生成视频缩略图并保存到缓存目录
 * @param videoPath 视频文件路径
 * @param videoUrl 视频 URL（用于加载视频）
 * @returns 缩略图缓存路径
 */
export async function generateAndCacheVideoThumbnail(videoPath: string, videoUrl: string): Promise<string> {
    const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const { getThumbnailsPath } = await import('./dataPath')

    // 获取缓存路径
    const cachePath = await getVideoThumbnailCachePath(videoPath)

    // 确保目录存在
    const thumbnailsDir = await getThumbnailsPath()
    const dirExists = await exists(thumbnailsDir)
    if (!dirExists) {
        await mkdir(thumbnailsDir, { recursive: true })
    }

    // 使用 video 元素加载视频并截取帧
    return new Promise((resolve, reject) => {
        const video = document.createElement('video')
        video.crossOrigin = 'anonymous'
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'

        // 超时保护
        const timeout = setTimeout(() => {
            reject(new Error('Video thumbnail generation timeout'))
        }, 15000)

        // 实际截图逻辑
        const captureFrame = async () => {
            try {
                clearTimeout(timeout)

                // 计算缩放尺寸 (最大 200x200)
                const MAX_SIZE = 200
                let width = video.videoWidth
                let height = video.videoHeight

                if (width === 0 || height === 0) {
                    reject(new Error('Video dimensions are zero'))
                    return
                }

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

                // 绘制到 Canvas
                const canvas = document.createElement('canvas')
                canvas.width = Math.floor(width)
                canvas.height = Math.floor(height)
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'))
                    return
                }

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

                // 转换为 Blob -> Uint8Array
                const blob = await new Promise<Blob | null>(res =>
                    canvas.toBlob(res, 'image/webp', 0.8)
                )
                if (!blob) {
                    reject(new Error('Failed to create video thumbnail blob'))
                    return
                }

                const arrayBuffer = await blob.arrayBuffer()
                const uint8Array = new Uint8Array(arrayBuffer)

                // 保存到缓存
                await writeFile(cachePath, uint8Array)
                resolve(cachePath)
            } catch (err) {
                clearTimeout(timeout)
                reject(err)
            }
        }

        // 当视频元数据加载完成后，跳转到 0.1 秒处
        video.onloadedmetadata = () => {
            // 设置 currentTime 到 0.1 秒（避免第一帧黑屏/透明问题）
            video.currentTime = 0.1
        }

        // 当视频跳转完成后（帧已准备好），截取图片
        video.onseeked = () => {
            captureFrame()
        }

        video.onerror = () => {
            clearTimeout(timeout)
            reject(new Error('Failed to load video for thumbnail'))
        }

        video.src = videoUrl
        video.load()
    })
}

/**
 * 获取或创建视频缩略图（优先使用缓存）
 * @param videoPath 视频文件路径
 * @param videoUrl 视频 URL（用于加载视频，可选）
 * @returns { filePath: string, dataUrl: string } 缩略图文件路径和 Data URL
 */
export async function getOrCreateVideoThumbnail(
    videoPath: string,
    videoUrl?: string
): Promise<{ filePath: string; dataUrl: string }> {
    const { exists, readFile } = await import('@tauri-apps/plugin-fs')
    const { convertFileSrc } = await import('@tauri-apps/api/core')

    // 获取缓存路径
    const cachePath = await getVideoThumbnailCachePath(videoPath)

    // 检查缓存是否存在
    const cacheExists = await exists(cachePath)

    if (cacheExists) {
        // 缓存存在，读取并返回
        const bytes = await readFile(cachePath)
        const blob = new Blob([bytes], { type: 'image/webp' })
        const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
        })
        return { filePath: cachePath, dataUrl }
    }

    // 缓存不存在，生成缩略图
    // 如果没有提供 videoUrl，从 videoPath 生成
    const url = videoUrl || convertFileSrc(videoPath)
    const generatedPath = await generateAndCacheVideoThumbnail(videoPath, url)

    // 读取生成的缩略图
    const bytes = await readFile(generatedPath)
    const blob = new Blob([bytes], { type: 'image/webp' })
    const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
    })

    return { filePath: generatedPath, dataUrl }
}

// ==================== 图片缩略图缓存系统 ====================

/**
 * 根据图片文件路径生成对应的缩略图缓存路径
 * @param imagePath 图片文件路径
 * @returns 缩略图缓存路径
 */
export async function getImageThumbnailCachePath(imagePath: string): Promise<string> {
    const { getThumbnailsPath } = await import('./dataPath')
    const { join, basename } = await import('@tauri-apps/api/path')

    const thumbnailsDir = await getThumbnailsPath()
    const imageName = await basename(imagePath)
    // 将扩展名改为 .webp（体积更小）
    const thumbName = imageName.replace(/\.[^.]+$/, '.webp')
    return await join(thumbnailsDir, thumbName)
}

/**
 * 生成图片缩略图并保存到缓存目录
 * @param imagePath 图片文件路径
 * @param imageUrl 图片 URL（用于加载图片）
 * @returns 缩略图缓存路径
 */
export async function generateAndCacheImageThumbnail(imagePath: string, imageUrl: string): Promise<string> {
    const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs')
    const { getThumbnailsPath } = await import('./dataPath')

    // 获取缓存路径
    const cachePath = await getImageThumbnailCachePath(imagePath)

    // 确保目录存在
    const thumbnailsDir = await getThumbnailsPath()
    const dirExists = await exists(thumbnailsDir)
    if (!dirExists) {
        await mkdir(thumbnailsDir, { recursive: true })
    }

    // 加载图片并生成缩略图
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'

        // 超时保护
        const timeout = setTimeout(() => {
            reject(new Error('Image thumbnail generation timeout'))
        }, 15000)

        img.onload = async () => {
            try {
                clearTimeout(timeout)

                // 计算缩放尺寸 (最大 200x200)
                const MAX_SIZE = 200
                let width = img.naturalWidth
                let height = img.naturalHeight

                if (width === 0 || height === 0) {
                    reject(new Error('Image dimensions are zero'))
                    return
                }

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

                // 绘制到 Canvas
                const canvas = document.createElement('canvas')
                canvas.width = Math.floor(width)
                canvas.height = Math.floor(height)
                const ctx = canvas.getContext('2d')
                if (!ctx) {
                    reject(new Error('Failed to get canvas context'))
                    return
                }

                ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

                // 转换为 Blob -> Uint8Array (WebP 更小)
                const blob = await new Promise<Blob | null>(res =>
                    canvas.toBlob(res, 'image/webp', 0.8)
                )
                if (!blob) {
                    reject(new Error('Failed to create image thumbnail blob'))
                    return
                }

                const arrayBuffer = await blob.arrayBuffer()
                const uint8Array = new Uint8Array(arrayBuffer)

                // 保存到缓存
                await writeFile(cachePath, uint8Array)
                resolve(cachePath)
            } catch (err) {
                clearTimeout(timeout)
                reject(err)
            }
        }

        img.onerror = () => {
            clearTimeout(timeout)
            reject(new Error('Failed to load image for thumbnail'))
        }

        img.src = imageUrl
    })
}

/**
 * 获取或创建图片缩略图（优先使用缓存）
 * @param imagePath 图片文件路径
 * @param imageUrl 图片 URL（用于加载图片，可选）
 * @returns { filePath: string, dataUrl: string } 缩略图文件路径和 Data URL
 */
export async function getOrCreateImageThumbnail(
    imagePath: string,
    imageUrl?: string
): Promise<{ filePath: string; dataUrl: string }> {
    const { exists, readFile } = await import('@tauri-apps/plugin-fs')
    const { convertFileSrc } = await import('@tauri-apps/api/core')

    // 获取缓存路径
    const cachePath = await getImageThumbnailCachePath(imagePath)

    // 检查缓存是否存在
    const cacheExists = await exists(cachePath)

    if (cacheExists) {
        // 缓存存在，读取并返回
        const bytes = await readFile(cachePath)
        const blob = new Blob([bytes], { type: 'image/webp' })
        const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result as string)
            reader.readAsDataURL(blob)
        })
        return { filePath: cachePath, dataUrl }
    }

    // 缓存不存在，生成缩略图
    const url = imageUrl || convertFileSrc(imagePath)
    const generatedPath = await generateAndCacheImageThumbnail(imagePath, url)

    // 读取生成的缩略图
    const bytes = await readFile(generatedPath)
    const blob = new Blob([bytes], { type: 'image/webp' })
    const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
    })

    return { filePath: generatedPath, dataUrl }
}

/**
 * 删除媒体文件对应的缩略图缓存
 * @param mediaPath 媒体文件路径（图片或视频）
 * @returns 是否成功删除
 */
export async function deleteThumbnailCache(mediaPath: string): Promise<boolean> {
    try {
        const { exists, remove } = await import('@tauri-apps/plugin-fs')
        const { getThumbnailsPath } = await import('./dataPath')
        const { join, basename } = await import('@tauri-apps/api/path')

        const thumbnailsDir = await getThumbnailsPath()
        const mediaName = await basename(mediaPath)
        // 缩略图扩展名统一为 .webp
        const thumbName = mediaName.replace(/\.[^.]+$/, '.webp')
        const thumbPath = await join(thumbnailsDir, thumbName)

        // 检查缩略图是否存在
        const thumbExists = await exists(thumbPath)
        if (thumbExists) {
            await remove(thumbPath)
            console.log('[缩略图缓存] 已删除:', thumbPath)
            return true
        }
        return false
    } catch (error) {
        console.error('[缩略图缓存] 删除失败:', error)
        return false
    }
}
