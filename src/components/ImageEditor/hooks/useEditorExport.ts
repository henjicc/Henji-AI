/**
 * useEditorExport - 导出编辑后图片的 Hook
 */
import { useCallback } from 'react'
import Konva from 'konva'


export interface ExportOptions {
    pixelRatio?: number
    mimeType?: string
    quality?: number
}

export interface UseEditorExportReturn {
    exportToDataUrl: (stage: Konva.Stage, options?: ExportOptions) => Promise<string>
    exportAndCompress: (stage: Konva.Stage, options?: ExportOptions) => Promise<string>
}

export function useEditorExport(): UseEditorExportReturn {
    // 导出为 DataUrl
    const exportToDataUrl = useCallback(async (stage: Konva.Stage, options?: ExportOptions): Promise<string> => {
        // 获取所有 Transformer，暂时隐藏
        const transformers = stage.find('Transformer')
        transformers.forEach(tr => tr.hide())

        // 导出为 dataUrl
        const dataUrl = stage.toDataURL({
            mimeType: options?.mimeType || 'image/jpeg',
            quality: options?.quality || 0.92,
            pixelRatio: options?.pixelRatio || 2,
        })

        // 恢复 Transformer 显示
        transformers.forEach(tr => tr.show())

        return dataUrl
    }, [])

    // 导出并压缩（使用现有的压缩逻辑）
    const exportAndCompress = useCallback(async (stage: Konva.Stage, options?: ExportOptions): Promise<string> => {
        const rawDataUrl = await exportToDataUrl(stage, options)

        // 动态导入压缩函数，避免循环依赖
        const { dataUrlToBlob, saveUploadImage } = await import('@/utils/save')

        // 转为 Blob
        const blob = await dataUrlToBlob(rawDataUrl)

        // 通过 saveUploadImage 压缩（memory 模式）
        const saved = await saveUploadImage(blob, 'memory')

        return saved.dataUrl
    }, [exportToDataUrl])

    return {
        exportToDataUrl,
        exportAndCompress,
    }
}

export default useEditorExport
