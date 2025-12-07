import { ParamDef } from '../types/schema'

/**
 * PixVerse V4.5 模型参数定义
 */
export const pixverseV45Params: ParamDef[] = [
    {
        id: 'ppioPixverse45VideoAspectRatio',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: '16:9',
        // 分辨率配置：不启用智能匹配，将分辨率作为质量选项
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: false,
            visualize: true,
            extractRatio: (value) => {
                const [w, h] = value.split(':').map(Number)
                return w / h
            },
            // 指定分辨率参数的key
            qualityKey: 'ppioPixverse45VideoResolution',
            // 分辨率选项（作为质量选项显示）
            qualityOptions: (values: any) => [
                { value: '360p', label: '360P' },
                { value: '540p', label: '540P' },
                { value: '720p', label: '720P' },
                { value: '1080p', label: '1080P', disabled: values.ppioPixverse45FastMode }
            ]
        },
        options: (values) => {
            // 图生视频时不显示比例选项（比例由图片决定）
            if (values.uploadedImages.length > 0) {
                return []
            }
            return [
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '1:1', label: '1:1' }
            ]
        }
    },
    {
        id: 'ppioPixverse45FastMode',
        type: 'toggle',
        label: '快速模式'
    }
]
