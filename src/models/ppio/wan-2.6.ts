import { ParamDef } from '../../types/schema'

interface ParamValues {
    ppioWan26Mode?: string
    ppioWan26AspectRatio?: string
    ppioWan26Quality?: string
    ppioWan26VideoDuration?: number
    uploadedImages?: string[]
}

/**
 * PPIO Wan 2.6 参数定义
 * 支持 2 种模式：文/图生视频、参考生视频
 */
export const ppioWan26Params: ParamDef[] = [
    // 模式选择
    {
        id: 'ppioWan26Mode',
        type: 'dropdown',
        label: '模式',
        defaultValue: 'text-image-to-video',
        options: [
            { value: 'text-image-to-video', label: '文/图生视频' },
            { value: 'reference-to-video', label: '参考生视频' }
        ],
        className: 'min-w-[120px]'
    },

    // 分辨率（特殊面板：比例 + 质量档位）
    {
        id: 'ppioWan26AspectRatio',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: '16:9',
        // 分辨率配置：比例 + 质量档位模式
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,        // 启用智能匹配
            visualize: true,         // 显示可视化预览
            extractRatio: (value: string) => {
                if (value === 'smart') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            },
            qualityOptions: [
                { value: '720P', label: '720P' },
                { value: '1080P', label: '1080P' }
            ],
            qualityKey: 'ppioWan26Quality',
            defaultQuality: '720P'
        },
        // 自动切换逻辑：图生视频模式上传图片后自动切换到智能选项
        autoSwitch: [
            {
                // 上传图片后切换到智能
                condition: (values: ParamValues) => {
                    const mode = values.ppioWan26Mode || 'text-image-to-video'
                    const imageCount = values.uploadedImages?.length || 0
                    const currentRatio = values.ppioWan26AspectRatio
                    return mode === 'text-image-to-video' &&
                        imageCount > 0 &&
                        currentRatio !== 'smart'
                },
                value: 'smart',
                watchKeys: ['uploadedImages']
            },
            {
                // 删除所有图片后，将智能重置为具体比例
                condition: (values: ParamValues) => {
                    const mode = values.ppioWan26Mode || 'text-image-to-video'
                    const imageCount = values.uploadedImages?.length || 0
                    const currentRatio = values.ppioWan26AspectRatio
                    return mode === 'text-image-to-video' &&
                        imageCount === 0 &&
                        currentRatio === 'smart'
                },
                value: '16:9',
                watchKeys: ['uploadedImages']
            }
        ],
        // 根据模式和图片动态生成选项
        options: (values: ParamValues) => {
            const mode = values.ppioWan26Mode || 'text-image-to-video'
            const imageCount = values.uploadedImages?.length || 0

            const baseOptions = [
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '1:1', label: '1:1' },
                { value: '4:3', label: '4:3' },
                { value: '3:4', label: '3:4' }
            ]

            // 文/图生视频模式且有图片：显示智能选项
            if (mode === 'text-image-to-video' && imageCount > 0) {
                return [{ value: 'smart', label: '智能' }, ...baseOptions]
            }

            return baseOptions
        }
    },

    // 质量档位（由 resolutionConfig.qualityKey 关联）
    {
        id: 'ppioWan26Quality',
        type: 'dropdown',
        defaultValue: '720P',
        options: [
            { value: '720P', label: '720P' },
            { value: '1080P', label: '1080P' }
        ],
        hidden: true  // 通过 resolutionConfig 显示，不单独显示
    },

    // 时长（根据模式动态调整选项）
    {
        id: 'ppioWan26VideoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,
        options: (values: ParamValues) => {
            const mode = values.ppioWan26Mode || 'text-image-to-video'

            if (mode === 'reference-to-video') {
                // 参考生视频：5s, 10s
                return [
                    { value: 5, label: '5s' },
                    { value: 10, label: '10s' }
                ]
            } else {
                // 文/图生视频：5s, 10s, 15s
                return [
                    { value: 5, label: '5s' },
                    { value: 10, label: '10s' },
                    { value: 15, label: '15s' }
                ]
            }
        },
        // 切换到参考生视频且当前时长为 15s 时，自动切换到 10s
        autoSwitch: {
            condition: (values: ParamValues) => {
                const mode = values.ppioWan26Mode || 'text-image-to-video'
                const duration = values.ppioWan26VideoDuration || 5
                return mode === 'reference-to-video' && duration === 15
            },
            value: 10,
            watchKeys: ['ppioWan26Mode']
        }
    },

    // 镜头类型
    {
        id: 'ppioWan26ShotType',
        type: 'dropdown',
        label: '镜头类型',
        defaultValue: 'multi',
        options: [
            { value: 'single', label: '单镜头' },
            { value: 'multi', label: '多镜头' }
        ]
    },

    // 生成音频
    {
        id: 'ppioWan26Audio',
        type: 'toggle',
        label: '生成音频',
        defaultValue: true
    },

    // 提示词优化
    {
        id: 'ppioWan26PromptExtend',
        type: 'toggle',
        label: '提示词优化',
        defaultValue: false,
        tooltip: '开启后使用大模型对输入 prompt 进行智能改写。对于较短的 prompt 生成效果提升明显，但会增加耗时。'
    }
]
