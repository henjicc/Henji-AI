import { ParamDef } from '../types/schema'

/**
 * Fal.ai Vidu Q2 模型参数定义
 */
export const falAiViduQ2Params: ParamDef[] = [
    {
        id: 'viduQ2Mode',
        type: 'dropdown',
        label: '模式',
        defaultValue: 'text-to-video',
        // 智能切换模式：根据上传的图片/视频数量自动切换
        // 注意：不要将 viduQ2Mode 本身作为切换条件，避免无限循环
        autoSwitch: {
            condition: (values) => {
                const { uploadedImages, uploadedVideos, viduQ2Mode } = values
                const imageCount = uploadedImages?.length || 0
                const videoCount = uploadedVideos?.length || 0

                // 计算应该切换到的目标模式
                let targetMode: string
                if (videoCount > 0) {
                    targetMode = 'video-extension'
                } else if (imageCount > 1) {
                    targetMode = 'reference-to-video'
                } else if (imageCount === 1) {
                    targetMode = 'image-to-video'
                } else {
                    targetMode = 'text-to-video'
                }

                // 只有当目标模式与当前模式不同时才切换
                return viduQ2Mode !== targetMode
            },
            value: (values: any) => {
                const imageCount = values.uploadedImages?.length || 0
                const videoCount = values.uploadedVideos?.length || 0

                if (videoCount > 0) return 'video-extension'
                if (imageCount > 1) return 'reference-to-video'
                if (imageCount === 1) return 'image-to-video'
                return 'text-to-video'
            }
        },
        options: [
            { value: 'text-to-video', label: '文生视频' },
            { value: 'image-to-video', label: '图生视频' },
            { value: 'reference-to-video', label: '参考生视频' },
            { value: 'video-extension', label: '视频延长' }
        ],
        className: 'min-w-[120px]'
    },
    {
        id: 'viduQ2AspectRatio',
        type: 'dropdown',
        defaultValue: '16:9',
        // 文生视频和参考生视频模式下显示（带比例选择）
        hidden: (values) => {
            const mode = values.viduQ2Mode || 'text-to-video'
            return mode === 'image-to-video' || mode === 'video-extension'
        },
        // 分辨率配置：整合比例和分辨率到统一面板
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            extractRatio: (value) => {
                if (value === 'smart' || value === 'auto') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            },
            qualityOptions: [
                { value: '360p', label: '360P' },
                { value: '520p', label: '520P' },
                { value: '720p', label: '720P' },
                { value: '1080p', label: '1080P' }
            ],
            qualityKey: 'viduQ2Resolution'
        },
        // 当上传图片时自动切换到智能选项
        autoSwitch: {
            condition: (values) => {
                const mode = values.viduQ2Mode || 'text-to-video'
                const imageCount = values.uploadedImages?.length || 0
                // 仅在参考生视频模式下，有图片时自动切换到智能
                // 图生视频模式不需要切换，因为它不显示比例选择器
                return mode === 'reference-to-video' && imageCount > 0
            },
            value: 'smart'
        },
        // 根据模式动态生成选项
        options: (values) => {
            const mode = values.viduQ2Mode || 'text-to-video'
            const imageCount = values.uploadedImages?.length || 0

            // 文生视频和参考生视频模式：包含智能选项和三个比例
            const baseOptions = [
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '1:1', label: '1:1' }
            ]

            // 参考生视频模式且有图片时，添加智能选项
            if (mode === 'reference-to-video' && imageCount > 0) {
                return [{ value: 'smart', label: '智能' }, ...baseOptions]
            }

            return baseOptions
        },
        className: 'min-w-[100px]'
    },
    {
        id: 'viduQ2Resolution',
        type: 'dropdown',
        defaultValue: '720p',
        label: '分辨率',
        // 仅在图生视频和视频延长模式下显示（不带比例选择）
        hidden: (values) => {
            const mode = values.viduQ2Mode || 'text-to-video'
            return mode !== 'image-to-video' && mode !== 'video-extension'
        },
        // 使用特殊的分辨率面板样式（只显示质量选择，不显示比例）
        resolutionConfig: {
            type: 'resolution',
            qualityOptions: [
                { value: '720p', label: '720P' },
                { value: '1080p', label: '1080P' }
            ],
            qualityKey: 'viduQ2Resolution'
        },
        options: [],  // 空数组，因为不需要比例选择
        className: 'min-w-[100px]'
    },
    {
        id: 'videoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 4,
        options: (values) => {
            const mode = values.viduQ2Mode || 'text-to-video'

            // 视频延长模式：支持 2-7 秒
            if (mode === 'video-extension') {
                return [
                    { value: 2, label: '2s' },
                    { value: 3, label: '3s' },
                    { value: 4, label: '4s' },
                    { value: 5, label: '5s' },
                    { value: 6, label: '6s' },
                    { value: 7, label: '7s' }
                ]
            }

            // 其他模式：支持 2-8 秒
            return [
                { value: 2, label: '2s' },
                { value: 3, label: '3s' },
                { value: 4, label: '4s' },
                { value: 5, label: '5s' },
                { value: 6, label: '6s' },
                { value: 7, label: '7s' },
                { value: 8, label: '8s' }
            ]
        }
    },
    {
        id: 'viduQ2MovementAmplitude',
        type: 'dropdown',
        label: '运动幅度',
        defaultValue: 'auto',
        options: [
            { value: 'auto', label: '自动' },
            { value: 'small', label: '小' },
            { value: 'medium', label: '中' },
            { value: 'large', label: '大' }
        ],
        // 视频延长模式隐藏运动幅度选项
        hidden: (values) => values.viduQ2Mode === 'video-extension'
    },
    {
        id: 'viduQ2Bgm',
        type: 'toggle',
        label: '背景音乐',
        defaultValue: false,
        tooltip: '仅对4秒视频有效',
        tooltipDelay: 500
    },
    {
        id: 'viduQ2FastMode',
        type: 'toggle',
        label: '快速模式',
        defaultValue: true,
        tooltip: '开启后使用 Turbo 版本，速度更快但质量略低',
        tooltipDelay: 500,
        // 仅在图生视频模式下显示
        hidden: (values) => values.viduQ2Mode !== 'image-to-video'
    }
]
