import { ParamDef } from '../types/schema'

/**
 * Vidu Q1 模型参数定义
 */
export const viduQ1Params: ParamDef[] = [
    {
        id: 'viduMode',
        type: 'dropdown',
        label: '模式',
        options: [
            { value: 'text-image-to-video', label: '文/图生视频' },
            { value: 'start-end-frame', label: '首尾帧' },
            { value: 'reference-to-video', label: '参考生视频' }
        ],
        className: 'min-w-[120px]'
    },
    {
        id: 'viduAspectRatio',
        type: 'dropdown',
        label: '宽高比',
        options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ],
        hidden: (values) => {
            const { viduMode, uploadedImages } = values
            // Show if: (text-image mode AND no images) OR (reference mode)
            const isTextImageNoImg = viduMode === 'text-image-to-video' && uploadedImages.length === 0
            const isRefMode = viduMode === 'reference-to-video'
            return !(isTextImageNoImg || isRefMode)
        }
    },
    {
        id: 'viduStyle',
        type: 'dropdown',
        label: '风格',
        options: [
            { value: 'general', label: '通用' },
            { value: 'anime', label: '动漫' }
        ],
        hidden: (values) => {
            // Show only if: text-image mode AND no images
            return !(values.viduMode === 'text-image-to-video' && values.uploadedImages.length === 0)
        }
    },
    {
        id: 'viduMovementAmplitude',
        type: 'dropdown',
        label: '运动幅度',
        options: [
            { value: 'auto', label: '自动' },
            { value: 'small', label: '小' },
            { value: 'medium', label: '中' },
            { value: 'large', label: '大' }
        ]
    },
    {
        id: 'viduBgm',
        type: 'dropdown',
        label: 'BGM',
        options: [
            { value: false, label: '关闭' },
            { value: true, label: '开启' }
        ]
    }
]
