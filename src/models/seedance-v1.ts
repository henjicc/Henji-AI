import { ParamDef } from '../types/schema'

/**
 * Seedance V1 模型参数定义
 */
export const seedanceV1Params: ParamDef[] = [
    {
        id: 'seedanceVariant',
        type: 'dropdown',
        label: '版本',
        options: [
            { value: 'lite', label: 'Lite' },
            { value: 'pro', label: 'Pro' }
        ],
        hidden: (values) => values.selectedModel !== 'seedance-v1'
    },
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,  // Seedance 默认 5 秒
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'seedanceResolution',
        type: 'dropdown',
        defaultValue: '720p',
        // 分辨率配置：使用面板显示
        resolutionConfig: {
            type: 'resolution',
            smartMatch: false,
            visualize: false
        },
        options: [
            { value: '480p', label: '480P' },
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P' }
        ]
    },
    {
        id: 'seedanceAspectRatio',
        type: 'dropdown',
        defaultValue: '16:9',
        // 分辨率配置：启用智能匹配和可视化
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            extractRatio: (value) => {
                if (value === 'smart') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            }
        },
        // 当上传图片时自动切换到智能选项
        autoSwitch: {
            condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
            value: 'smart'
        },
        options: [
            { value: 'smart', label: '智能' },
            ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'].map(v => ({ value: v, label: v }))
        ]
    },
    {
        id: 'seedanceCameraFixed',
        type: 'toggle',
        label: '相机固定'
    }
]
