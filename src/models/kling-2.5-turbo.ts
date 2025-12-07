import { ParamDef } from '../types/schema'

/**
 * 可灵 2.5 Turbo 模型参数定义
 */
export const klingTurbo25Params: ParamDef[] = [
    {
        id: 'ppioKling25VideoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,  // Kling 默认 5 秒
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'ppioKling25VideoAspectRatio',
        type: 'dropdown',
        defaultValue: '16:9',
        // 分辨率配置：启用可视化
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: false,
            visualize: true,
            extractRatio: (value) => {
                const [w, h] = value.split(':').map(Number)
                return w / h
            }
        },
        options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ],
        // 图生视频时隐藏比例参数（API 不支持）
        hidden: (values) => values.uploadedImages && values.uploadedImages.length > 0
    },
    {
        id: 'ppioKling25CfgScale',
        type: 'number',
        label: 'CFG Scale',
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        widthClassName: 'w-24'
    }
]
