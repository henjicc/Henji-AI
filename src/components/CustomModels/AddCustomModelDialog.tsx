/**
 * 添加自定义模型对话框
 */

import React, { useState } from 'react'

interface AddCustomModelDialogProps {
  onAdd: (name: string, modelUrl: string, description?: string) => void
  onClose: () => void
}

export function AddCustomModelDialog({ onAdd, onClose }: AddCustomModelDialogProps) {
  const [name, setName] = useState('')
  const [modelUrl, setModelUrl] = useState('')
  const [description, setDescription] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim() || !modelUrl.trim()) {
      alert('请填写模型名称和 URL')
      return
    }

    onAdd(name.trim(), modelUrl.trim(), description.trim() || undefined)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">添加自定义模型</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              模型名称 *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder="例如：我的自定义模型"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              ModelScope URL *
            </label>
            <input
              type="text"
              value={modelUrl}
              onChange={(e) => setModelUrl(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              placeholder="例如：damo/text-to-image-synthesis"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              描述（可选）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              rows={3}
              placeholder="模型的简短描述"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border rounded hover:bg-gray-100"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              添加
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
