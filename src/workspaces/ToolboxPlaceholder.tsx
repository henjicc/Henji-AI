import React from 'react'

/**
 * 工具箱占位组件
 */
const ToolboxPlaceholder: React.FC = () => {
    return (
        <div className="flex-1 flex items-center justify-center h-full bg-[#0a0a0a]">
            <div className="text-gray-500 text-lg">开发中……</div>
        </div>
    )
}

export default ToolboxPlaceholder
