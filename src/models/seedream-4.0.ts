import { ParamDef } from '../types/schema'

/**
 * 即梦 4.0 模型参数定义
 */
export const seedream40Params: ParamDef[] = [
    {
        id: 'selectedResolution',
        type: 'dropdown',
        label: '分辨率',
        defaultValue: 'smart',
        // 分辨率配置：启用智能匹配、可视化、自定义输入和质量选项
        resolutionConfig: {
            type: 'aspect_ratio',
            smartMatch: true,
            visualize: true,
            customInput: true,
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
        id: 'maxImages',
        type: 'number',
        label: '数量',
        min: 1,
        max: 15,
        step: 1,
        widthClassName: 'w-20',
        tooltip: '设置为1时仅生成单张图片；大于1时，会根据该数值生成多张图片。参考图+生成图片的总数不能超过15张。',
        tooltipDelay: 500
    }
]
