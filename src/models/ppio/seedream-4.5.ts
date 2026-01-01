import { ParamDef } from '../../types/schema'

/**
 * 派欧云即梦 4.5 模型参数定义
 *
 * 分辨率约束（派欧云限制）：
 * - 宽高比范围：[1/16, 16]
 * - 最小尺寸：宽度和高度都 > 14 像素
 * - 总像素取值范围：[3686400, 16777216]（约 1920x1920 到 4096x4096）
 * - 2K模式：目标像素 2048×2048 = 4,194,304
 * - 4K模式：目标像素 4096×4096 = 16,777,216
 *
 * 与 4.0 版本的主要差异：
 * - 新增 optimize_prompt_options 提示词优化开关
 * - watermark 不在界面显示，但固定传 false
 * - 参数结构调整：images → image，max_images 嵌套到 sequential_image_generation_options
 */
export const seedream45Params: ParamDef[] = [
    {
        id: 'selectedResolution',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: 'smart',
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            customInput: true,
            useSeedreamCalculator: true,
            seedreamProvider: 'ppio',
            baseSizeEditable: false,
            extractRatio: (value) => {
                if (value === 'smart') return null
                const [w, h] = value.split(':').map(Number)
                return w / h
            },
            qualityOptions: [
                { value: '2K', label: '高清 2K' },
                { value: '4K', label: '超清 4K' }
            ]
        },
        options: (values) => {
            const baseOptions = [
                { value: '21:9', label: '21:9' },
                { value: '16:9', label: '16:9' },
                { value: '3:2', label: '3:2' },
                { value: '4:3', label: '4:3' },
                { value: '1:1', label: '1:1' },
                { value: '3:4', label: '3:4' },
                { value: '2:3', label: '2:3' },
                { value: '9:16', label: '9:16' }
            ]

            // 图生图时添加智能选项在最前面
            if (values.uploadedImages && values.uploadedImages.length > 0) {
                return [{ value: 'smart', label: '智能' }, ...baseOptions]
            }

            return [{ value: 'smart', label: '智能' }, ...baseOptions]
        },
        className: 'min-w-[100px]'
    },
    {
        id: 'ppioSeedream45MaxImages',
        type: 'number',
        label: '数量',
        defaultValue: 1,
        min: 1,
        max: 15,
        step: 1,
        widthClassName: 'w-20',
        tooltip: '设置为1时仅生成单张图片；大于1时，会根据该数值生成多张图片。参考图+生成图片的总数不能超过15张。',
        tooltipDelay: 500
    },
    {
        id: 'ppioSeedream45OptimizePrompt',
        type: 'toggle',
        label: '提示词优化',
        defaultValue: false,
        tooltip: '开启后模型会自动优化提示词以获得更好的生成效果。当前仅支持标准模式。',
        tooltipDelay: 500
    }
]
