import { ParamDef } from '../types/schema'

/**
 * Seedance V1 模型参数定义
 */
export const seedanceV1Params: ParamDef[] = [
    {
        id: 'ppioSeedanceV1Variant',
        type: 'dropdown',
        label: '版本',
        options: [
            { value: 'lite', label: 'Lite' },
            { value: 'pro', label: 'Pro' }
        ],
        hidden: (values) => values.selectedModel !== 'seedance-v1'
    },
    {
        id: 'ppioSeedanceV1VideoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,  // Seedance 默认 5 秒
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'ppioSeedanceV1AspectRatio',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: '16:9',
        // 分辨率配置：启用智能匹配、可视化，并将分辨率作为质量选项
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            extractRatio: (value) => {
                if (value === 'smart') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            },
            // 指定分辨率参数的key
            qualityKey: 'ppioSeedanceV1Resolution',
            // 分辨率选项（作为质量选项显示）
            qualityOptions: [
                { value: '480p', label: '480P' },
                { value: '720p', label: '720P' },
                { value: '1080p', label: '1080P' }
            ]
        },
        // 当上传图片时自动切换到智能选项
        autoSwitch: {
            condition: (values) => values.uploadedImages && values.uploadedImages.length > 0,
            value: 'smart',
            watchKeys: ['uploadedImages']  // 只监听图片数量变化，避免用户手动选择比例时被强制切换
        },
        options: [
            { value: 'smart', label: '智能' },
            ...['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'].map(v => ({ value: v, label: v }))
        ]
    },
    {
        id: 'ppioSeedanceV1CameraFixed',
        type: 'toggle',
        label: '相机固定'
    }
]
