import { ParamDef } from '../../types/schema'

interface ParamValues {
    ppioKling26Mode?: string
    ppioKling26AspectRatio?: string
    uploadedImages?: string[]
    uploadedVideos?: string[]
}

/**
 * PPIO Kling 2.6 Pro 参数定义
 * 支持 2 种模式：文/图生视频、动作控制
 */
export const ppioKling26ProParams: ParamDef[] = [
    // 模式选择
    {
        id: 'ppioKling26Mode',
        type: 'dropdown',
        label: '模式',
        defaultValue: 'text-image-to-video',
        options: [
            { value: 'text-image-to-video', label: '文/图生视频' },
            { value: 'motion-control', label: '动作控制' }
        ],
        className: 'min-w-[120px]'
    },

    // 时长（仅文/图生视频模式）
    {
        id: 'ppioKling26VideoDuration',
        type: 'dropdown',
        label: '时长',
        defaultValue: 5,
        options: [
            { value: 5, label: '5s' },
            { value: 10, label: '10s' }
        ],
        hidden: (values: ParamValues) => values.ppioKling26Mode === 'motion-control'
    },

    // 宽高比（特殊面板，支持智能匹配）
    {
        id: 'ppioKling26AspectRatio',
        type: 'dropdown',
        defaultValue: '16:9',
        // 分辨率配置：启用智能匹配和可视化
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            extractRatio: (value: string) => {
                if (value === 'smart') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            }
        },
        // 自动切换逻辑：上传图片后切换到智能
        autoSwitch: [
            {
                // 在文/图生视频模式上传图片后自动切换到智能选项
                condition: (values: ParamValues) => {
                    const mode = values.ppioKling26Mode || 'text-image-to-video'
                    const imageCount = values.uploadedImages?.length || 0
                    const currentRatio = values.ppioKling26AspectRatio
                    return mode === 'text-image-to-video' &&
                        imageCount > 0 &&
                        currentRatio !== 'smart'
                },
                value: 'smart',
                watchKeys: ['ppioKling26Mode', 'uploadedImages']
            },
            {
                // 删除所有图片后，将智能重置为具体比例
                condition: (values: ParamValues) => {
                    const mode = values.ppioKling26Mode || 'text-image-to-video'
                    const imageCount = values.uploadedImages?.length || 0
                    const currentRatio = values.ppioKling26AspectRatio
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
            const mode = values.ppioKling26Mode || 'text-image-to-video'
            const imageCount = values.uploadedImages?.length || 0

            // 文/图生视频模式
            if (mode === 'text-image-to-video') {
                // 有图片：显示智能选项
                if (imageCount > 0) {
                    return [
                        { value: 'smart', label: '智能' },
                        { value: '16:9', label: '16:9' },
                        { value: '9:16', label: '9:16' },
                        { value: '1:1', label: '1:1' }
                    ]
                }
                // 无图片：不显示智能选项
                return [
                    { value: '16:9', label: '16:9' },
                    { value: '9:16', label: '9:16' },
                    { value: '1:1', label: '1:1' }
                ]
            }

            // 默认选项
            return [
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '1:1', label: '1:1' }
            ]
        },
        hidden: (values: ParamValues) => values.ppioKling26Mode === 'motion-control'
    },

    // CFG Scale（仅文/图生视频模式）
    {
        id: 'ppioKling26CfgScale',
        type: 'number',
        label: 'CFG Scale',
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        precision: 2,
        widthClassName: 'w-24',
        hidden: (values: ParamValues) => values.ppioKling26Mode === 'motion-control'
    },

    // 生成音频开关（仅文/图生视频模式）
    {
        id: 'ppioKling26Sound',
        type: 'toggle',
        label: '生成音频',
        defaultValue: false,
        hidden: (values: ParamValues) => values.ppioKling26Mode === 'motion-control'
    },

    // ===== 动作控制模式专用参数 =====

    // 人物朝向（仅动作控制模式）
    {
        id: 'ppioKling26CharacterOrientation',
        type: 'dropdown',
        label: '人物朝向',
        defaultValue: 'video',
        tooltip: '默认为人物朝向与视频一致，此时角色动作/表情/运镜/朝向都会按照动作视频生成。可以通过提示词控制其他信息。最长支持30s生成时长。\n\n选择人物朝向与图片一致，此时角色动作/表情都会按照动作视频生成，朝向与图片中人物朝向一致，运镜及其他信息可以通过提示词自定义。最长支持5s生成时长。',
        options: [
            { value: 'video', label: '人物朝向与视频一致' },
            { value: 'image', label: '人物朝向与图片一致' }
        ],
        hidden: (values: ParamValues) => values.ppioKling26Mode !== 'motion-control'
    },

    // 保留音频开关（仅动作控制模式）
    {
        id: 'ppioKling26KeepOriginalSound',
        type: 'toggle',
        label: '保留音频',
        defaultValue: true,
        hidden: (values: ParamValues) => values.ppioKling26Mode !== 'motion-control'
    }
]
