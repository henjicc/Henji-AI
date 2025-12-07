import { ParamDef } from '../types/schema'

/**
 * Vidu Q1 模型参数定义（派欧云）
 */
export const viduQ1Params: ParamDef[] = [
    {
        id: 'ppioViduQ1Mode',
        type: 'dropdown',
        label: '模式',
        defaultValue: 'text-image-to-video',
        // 根据上传的图片数量自动切换模式
        autoSwitch: {
            condition: (values) => {
                const { uploadedImages } = values
                const count = uploadedImages?.length || 0
                // 根据图片数量判断应该切换到哪个模式
                if (count === 0) return values.ppioViduQ1Mode !== 'text-image-to-video'
                if (count === 1) return values.ppioViduQ1Mode !== 'text-image-to-video'
                if (count === 2) return values.ppioViduQ1Mode !== 'start-end-frame'
                if (count >= 3) return values.ppioViduQ1Mode !== 'reference-to-video'
                return false
            },
            value: (values: any) => {
                const count = values.uploadedImages?.length || 0
                if (count === 0) return 'text-image-to-video'
                if (count === 1) return 'text-image-to-video'
                if (count === 2) return 'start-end-frame'
                return 'reference-to-video'
            }
        },
        options: [
            { value: 'text-image-to-video', label: '文/图生视频' },
            { value: 'start-end-frame', label: '首尾帧' },
            { value: 'reference-to-video', label: '参考生视频' }
        ],
        className: 'min-w-[120px]'
    },
    {
        id: 'ppioViduQ1VideoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 4,
        options: [
            { value: 4, label: '4秒' },
            { value: 8, label: '8秒' }
        ]
    },
    {
        id: 'ppioViduQ1AspectRatio',
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
        options: [
            { value: '16:9', label: '16:9' },
            { value: '9:16', label: '9:16' },
            { value: '1:1', label: '1:1' }
        ],
        hidden: (values) => {
            const { ppioViduQ1Mode, uploadedImages } = values
            // 首尾帧模式：隐藏
            if (ppioViduQ1Mode === 'start-end-frame') return true
            // 文/图生视频模式 + 有图片：隐藏（API 不支持传比例）
            if (ppioViduQ1Mode === 'text-image-to-video' && uploadedImages.length > 0) return true
            // 其他情况：显示
            return false
        }
    },
    {
        id: 'ppioViduQ1Style',
        type: 'dropdown',
        label: '风格',
        options: [
            { value: 'general', label: '通用' },
            { value: 'anime', label: '动漫' }
        ],
        hidden: (values) => {
            // Show only if: text-image mode AND no images
            return !(values.ppioViduQ1Mode === 'text-image-to-video' && values.uploadedImages.length === 0)
        }
    },
    {
        id: 'ppioViduQ1MovementAmplitude',
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
        id: 'ppioViduQ1Bgm',
        type: 'toggle',
        label: '生成音频'
    }
]
