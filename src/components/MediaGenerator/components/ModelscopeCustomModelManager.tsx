import React, { useState, useEffect } from 'react'
import TextInput from '@/components/ui/TextInput'

interface CustomModel {
  id: string
  name: string
}

interface ModelscopeCustomModelManagerProps {
  onModelsChange?: () => void
}

const ModelscopeCustomModelManager: React.FC<ModelscopeCustomModelManagerProps> = ({ onModelsChange }) => {
  const [models, setModels] = useState<CustomModel[]>([])
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // 加载模型列表
  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = () => {
    try {
      const stored = localStorage.getItem('modelscope_custom_models')
      if (stored) {
        setModels(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load custom models:', e)
    }
  }

  const saveModels = (newModels: CustomModel[]) => {
    try {
      localStorage.setItem('modelscope_custom_models', JSON.stringify(newModels))
      setModels(newModels)
      onModelsChange?.()
    } catch (e) {
      console.error('Failed to save custom models:', e)
    }
  }

  const handleAdd = () => {
    if (!newModelId.trim() || !newModelName.trim()) {
      alert('请输入模型ID和名称')
      return
    }

    // 检查是否已存在
    if (models.some(m => m.id === newModelId.trim())) {
      alert('该模型ID已存在')
      return
    }

    const newModels = [...models, { id: newModelId.trim(), name: newModelName.trim() }]
    saveModels(newModels)
    setNewModelId('')
    setNewModelName('')
  }

  const handleDelete = (id: string) => {
    if (confirm('确定要删除这个模型吗？')) {
      const newModels = models.filter(m => m.id !== id)
      saveModels(newModels)
    }
  }

  const handleStartEdit = (model: CustomModel) => {
    setEditingId(model.id)
    setEditName(model.name)
  }

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) {
      alert('名称不能为空')
      return
    }

    const newModels = models.map(m =>
      m.id === id ? { ...m, name: editName.trim() } : m
    )
    saveModels(newModels)
    setEditingId(null)
    setEditName('')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditName('')
  }

  return (
    <div className="flex flex-col h-full">
      {/* 添加新模型 */}
      <div className="mb-4 p-3 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg">
        <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">添加新模型</div>
        <div className="flex flex-col gap-2">
          <TextInput
            label="模型ID"
            value={newModelId}
            onChange={setNewModelId}
            placeholder="例如：black-forest-labs/FLUX.1-dev"
            className="w-full"
            inputClassName="w-full text-sm"
          />
          <TextInput
            label="显示名称"
            value={newModelName}
            onChange={setNewModelName}
            placeholder="例如：FLUX.1 Dev"
            className="w-full"
            inputClassName="w-full text-sm"
          />
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-[#007eff] text-white text-sm rounded hover:bg-[#0066cc] transition-colors"
          >
            添加
          </button>
        </div>
      </div>

      {/* 模型列表 */}
      <div className="flex-1 overflow-y-auto">
        {models.length === 0 ? (
          <div className="text-center text-sm text-zinc-400 py-8">
            暂无自定义模型，请添加
          </div>
        ) : (
          <div className="space-y-2">
            {models.map(model => (
              <div
                key={model.id}
                className="p-3 bg-zinc-50 dark:bg-zinc-700/30 rounded-lg border border-zinc-200 dark:border-zinc-700"
              >
                {editingId === model.id ? (
                  // 编辑模式
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      模型ID: {model.id}
                    </div>
                    <TextInput
                      label="显示名称"
                      value={editName}
                      onChange={setEditName}
                      className="w-full"
                      inputClassName="w-full text-sm"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSaveEdit(model.id)}
                        className="flex-1 px-3 py-1.5 bg-[#007eff] text-white text-xs rounded hover:bg-[#0066cc] transition-colors"
                      >
                        保存
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="flex-1 px-3 py-1.5 bg-zinc-300 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-xs rounded hover:bg-zinc-400 dark:hover:bg-zinc-500 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  // 显示模式
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {model.name}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 break-all">
                        {model.id}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-3 flex-shrink-0">
                      <button
                        onClick={() => handleStartEdit(model)}
                        className="px-2 py-1 text-xs text-[#007eff] hover:bg-[#007eff]/10 rounded transition-colors"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(model.id)}
                        className="px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default ModelscopeCustomModelManager
