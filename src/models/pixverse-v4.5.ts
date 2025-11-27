import { ParamDef } from '../types/schema'

/**
 * PixVerse V4.5 模型参数定义
 */
export const pixverseV45Params: ParamDef[] = [
    {
        id: 'videoAspectRatio',
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
            condition: (values) => values.uploadedImages.length > 0,
            value: 'smart'
        },
        options: [
            { value: 'smart', label: '智能' },
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ]
    },
    {
        id: 'videoResolution',
        type: 'dropdown',
        defaultValue: '540p',  // PixVerse 默认 540p
        // 分辨率配置：使用面板显示
        resolutionConfig: {
            type: 'resolution',
            smartMatch: false,
            visualize: false
        },
        options: (values) => [
            { value: '360p', label: '360P' },
            { value: '540p', label: '540P' },
            { value: '720p', label: '720P' },
            { value: '1080p', label: '1080P', disabled: values.pixFastMode }
        ]
    },
    {
        id: 'pixFastMode',
        type: 'toggle',
        label: '快速模式'
    }
]
