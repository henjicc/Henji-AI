import { ParamDef } from '../types/schema'

/**
 * PixVerse V4.5 模型参数定义
 */
export const pixverseV45Params: ParamDef[] = [
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
        id: 'videoResolution',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: '540p',  // PixVerse 默认 540p
        options: (values) => [
            { value: '360p', label: '360p' },
            { value: '540p', label: '540p' },
            { value: '720p', label: '720p' },
            { value: '1080p', label: '1080p', disabled: values.pixFastMode }
        ]
    },
    {
        id: 'pixFastMode',
        type: 'toggle',
        label: '快速模式'
    }
]
