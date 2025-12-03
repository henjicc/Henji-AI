import React, { useState, useEffect } from 'react'
import TextInput from '@/components/ui/TextInput'
import { open } from '@tauri-apps/plugin-shell'

interface CustomModel {
  id: string
  name: string
  modelType: {
    imageGeneration: boolean  // 图片生成
    imageEditing: boolean      // 图片编辑
  }
}

interface ModelscopeCustomModelManagerProps {
  onModelsChange?: () => void
}

const ModelscopeCustomModelManager: React.FC<ModelscopeCustomModelManagerProps> = ({ onModelsChange }) => {
  const [models, setModels] = useState<CustomModel[]>([])
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelType, setNewModelType] = useState({ imageGeneration: true, imageEditing: false })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editModelType, setEditModelType] = useState({ imageGeneration: true, imageEditing: false })
  const [isAddingNew, setIsAddingNew] = useState(false)

  // 加载模型列表
  useEffect(() => {
    loadModels()
  }, [])

  const loadModels = () => {
    try {
      const stored = localStorage.getItem('modelscope_custom_models')
      if (stored) {
        const loadedModels = JSON.parse(stored)
        // 兼容旧数据：如果没有 modelType 字段，默认为图片生成
        const migratedModels = loadedModels.map((m: any) => ({
          ...m,
          modelType: m.modelType || { imageGeneration: true, imageEditing: false }
        }))
        setModels(migratedModels)
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

    // 检查至少选择一个类型
    if (!newModelType.imageGeneration && !newModelType.imageEditing) {
      alert('请至少选择一个模型类型')
      return
    }

    // 检查是否已存在
    if (models.some(m => m.id === newModelId.trim())) {
      alert('该模型ID已存在')
      return
    }

    const newModels = [...models, {
      id: newModelId.trim(),
      name: newModelName.trim(),
      modelType: { ...newModelType }
    }]
    saveModels(newModels)
    setNewModelId('')
    setNewModelName('')
    setNewModelType({ imageGeneration: true, imageEditing: false })
    setIsAddingNew(false)
  }

  const handleOpenModelLibrary = async () => {
    try {
      await open('https://modelscope.cn/models?filter=inference_type&page=1&tabKey=task&tasks=hotTask:text-to-image-synthesis&type=tasks')
    } catch (error) {
      console.error('Failed to open model library:', error)
    }
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
    setEditModelType({ ...model.modelType })
  }

  const handleSaveEdit = (id: string) => {
    if (!editName.trim()) {
      alert('名称不能为空')
      return
    }

    // 检查至少选择一个类型
    if (!editModelType.imageGeneration && !editModelType.imageEditing) {
      alert('请至少选择一个模型类型')
      return
    }

    const newModels = models.map(m =>
      m.id === id ? { ...m, name: editName.trim(), modelType: { ...editModelType } } : m
    )
    saveModels(newModels)
    setEditingId(null)
    setEditName('')
    setEditModelType({ imageGeneration: true, imageEditing: false })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditModelType({ imageGeneration: true, imageEditing: false })
  }

  return (
    <div className="flex flex-col h-full">
      {/* 提示信息 */}
      <div className="mb-3 p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="text-xs text-blue-700 dark:text-blue-300">
          支持图片生成和图片编辑，可在
          <button
            onClick={handleOpenModelLibrary}
            className="mx-1 text-[#007eff] hover:underline font-medium"
          >
            模型库
          </button>
          找到所有支持的模型
        </div>
      </div>

      {/* 添加新模型按钮/表单 */}
      {!isAddingNew ? (
        <button
          onClick={() => setIsAddingNew(true)}
          className="mb-3 px-4 py-2 bg-[#007eff] text-white text-sm rounded hover:bg-[#0066cc] transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          添加新模型
        </button>
      ) : (
        <div className="mb-3 p-3 bg-zinc-100 dark:bg-zinc-700/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">添加新模型</div>
            <button
              onClick={() => {
                setIsAddingNew(false)
                setNewModelId('')
                setNewModelName('')
              }}
              className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
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
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">模型类型（至少选一个）</div>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newModelType.imageGeneration}
                    onChange={(e) => setNewModelType(prev => ({ ...prev, imageGeneration: e.target.checked }))}
                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-[#007eff] focus:ring-[#007eff] focus:ring-offset-0"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">图片生成</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newModelType.imageEditing}
                    onChange={(e) => setNewModelType(prev => ({ ...prev, imageEditing: e.target.checked }))}
                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-[#007eff] focus:ring-[#007eff] focus:ring-offset-0"
                  />
                  <span className="text-sm text-zinc-700 dark:text-zinc-300">图片编辑</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="flex-1 px-4 py-2 bg-[#007eff] text-white text-sm rounded hover:bg-[#0066cc] transition-colors"
              >
                确认添加
              </button>
              <button
                onClick={() => {
                  setIsAddingNew(false)
                  setNewModelId('')
                  setNewModelName('')
                  setNewModelType({ imageGeneration: true, imageEditing: false })
                }}
                className="px-4 py-2 bg-zinc-300 dark:bg-zinc-600 text-zinc-700 dark:text-zinc-300 text-sm rounded hover:bg-zinc-400 dark:hover:bg-zinc-500 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 模型列表 */}
      <div className="flex-1 overflow-y-auto">
        {models.length === 0 ? (
          <div className="text-center text-sm text-zinc-400 py-8">
            暂无自定义模型
          </div>
        ) : (
          <div className="space-y-2">
            {models.map(model => (
              <div
                key={model.id}
                className="p-3 bg-zinc-50 dark:bg-zinc-700/30 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-colors"
              >
                {editingId === model.id ? (
                  // 编辑模式
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-zinc-500 dark:text-zinc-400 break-all">
                      模型ID: {model.id}
                    </div>
                    <TextInput
                      label="显示名称"
                      value={editName}
                      onChange={setEditName}
                      className="w-full"
                      inputClassName="w-full text-sm"
                    />
                    <div className="flex flex-col gap-1.5">
                      <div className="text-xs font-medium text-zinc-600 dark:text-zinc-400">模型类型（至少选一个）</div>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editModelType.imageGeneration}
                            onChange={(e) => setEditModelType(prev => ({ ...prev, imageGeneration: e.target.checked }))}
                            className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-[#007eff] focus:ring-[#007eff] focus:ring-offset-0"
                          />
                          <span className="text-sm text-zinc-700 dark:text-zinc-300">图片生成</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editModelType.imageEditing}
                            onChange={(e) => setEditModelType(prev => ({ ...prev, imageEditing: e.target.checked }))}
                            className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-[#007eff] focus:ring-[#007eff] focus:ring-offset-0"
                          />
                          <span className="text-sm text-zinc-700 dark:text-zinc-300">图片编辑</span>
                        </label>
                      </div>
                    </div>
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
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {model.name}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 break-all">
                        {model.id}
                      </div>
                      <div className="flex gap-2 mt-1.5">
                        {model.modelType.imageGeneration && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                            图片生成
                          </span>
                        )}
                        {model.modelType.imageEditing && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                            图片编辑
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleStartEdit(model)}
                        className="px-2.5 py-1 text-xs text-[#007eff] hover:bg-[#007eff]/10 rounded transition-colors"
                        title="编辑"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(model.id)}
                        className="px-2.5 py-1 text-xs text-red-500 hover:bg-red-500/10 rounded transition-colors"
                        title="删除模型"
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
