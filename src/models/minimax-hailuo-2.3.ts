import { ParamDef } from '../types/schema'

/**
 * Minimax 海螺 2.3 模型参数定义
 */
export const minimaxHailuo23Params: ParamDef[] = [
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 6,  // Hailuo 默认 6 秒
        options: [
            { value: 6, label: '6s' },
            { value: 10, label: '10s' }
        ]
    },
    {
        id: 'videoResolution',
        type: 'dropdown',
        defaultValue: '768P',  // Hailuo 默认 768P
        // 分辨率配置：使用面板显示
        resolutionConfig: {
            type: 'resolution',
            smartMatch: false,
            visualize: false
        },
        options: (values) => [
            { value: '768P', label: '768P' },
            { value: '1080P', label: '1080P', disabled: values.videoDuration !== 6 }
        ]
    },
    {
        id: 'hailuoFastMode',
        type: 'toggle',
        label: 'Fast模式',
        hidden: (values) => {
            // Show only if model is 'minimax-hailuo-2.3' AND images are uploaded
            return !(values.selectedModel === 'minimax-hailuo-2.3' && values.uploadedImages.length > 0)
        }
    }
]
