import { ParamDef } from '../types/schema'

/**
 * Fal.ai Nano Banana 模型参数定义
 */
export const falAiNanoBananaParams: ParamDef[] = [
    {
        id: 'falNanoBananaNum_images',
        type: 'number',
        label: '数量',
        min: 1,
        max: 4,
        step: 1,
        widthClassName: 'w-20'
    },
    {
        id: 'falNanoBananaAspectRatio',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: '1:1',  // 文生图默认 1:1
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
        // 始终显示智能选项
        options: [
            { value: 'smart', label: '智能' },
            { value: '1:1', label: '1:1' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '21:9', label: '21:9' },
            { value: '3:2', label: '3:2' },
            { value: '2:3', label: '2:3' },
            { value: '4:3', label: '4:3' },
            { value: '3:4', label: '3:4' },
            { value: '5:4', label: '5:4' },
            { value: '4:5', label: '4:5' }
        ],
        className: 'min-w-[100px]'
    }
]
