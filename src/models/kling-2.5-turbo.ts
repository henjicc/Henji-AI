import { ParamDef } from '../types/schema'

/**
 * 可灵 2.5 Turbo 模型参数定义
 */
export const klingTurbo25Params: ParamDef[] = [
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,  // Kling 默认 5 秒
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'videoAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ],
        hidden: (values) => values.uploadedImages.length > 0
    },
    {
        id: 'klingCfgScale',
        type: 'number',
        label: 'CFG Scale',
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        widthClassName: 'w-24'
    }
]
