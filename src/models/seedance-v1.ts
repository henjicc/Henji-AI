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
        label: '分辨率',
        options: ['480p', '720p', '1080p'].map(v => ({ value: v, label: v }))
    },
    {
        id: 'seedanceAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '9:21'].map(v => ({ value: v, label: v })),
        hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0
    },
    {
        id: 'seedanceCameraFixed',
        type: 'toggle',
        label: '相机固定'
    }
]
