# 2-4-1 集成ImageEditor

## 目标

将现有的 ImageEditor 集成到新的上传组件系统中

## 背景

项目中已有 ImageEditor 组件（`src/components/ImageEditor/`），功能包括：
- 裁剪、缩放
- 历史记录（撤销/重做）
- 用于图片上传前的预处理

需要将其无缝集成到新的参数系统中

## 前置依赖

- [ ] 2-1-3：实现上传组件

## 实施步骤

1. [ ] 分析现有 ImageEditor
   - 查看 `src/components/ImageEditor/` 目录
   - 了解组件 API 和使用方式
   - 确认功能完整性

2. [ ] 创建编辑器配置接口
   - 定义 ImageEditorConfig 接口
   - 支持启用/禁用编辑器
   - 支持自定义编辑选项

3. [ ] 集成到 ImageUpload 组件
   - 在上传完成后显示编辑器
   - 支持编辑后保存
   - 支持取消编辑

4. [ ] 处理编辑结果
   - 将编辑后的图片转换为需要的格式
   - 更新上传列表
   - 触发 onChange 回调

5. [ ] 添加编辑器触发方式
   - 上传后自动打开（可配置）
   - 点击已上传图片重新编辑
   - 提供编辑按钮

6. [ ] 优化用户体验
   - 添加加载状态
   - 保持编辑历史
   - 支持快捷键

7. [ ] 更新类型定义
   - 在 ImageUploadParamDef 中添加编辑器配置
   - 确保类型安全

8. [ ] 编写测试
   - 测试编辑器打开/关闭
   - 测试编辑结果保存
   - 测试取消编辑

## 涉及文件

### 检查文件
- `src/components/ImageEditor/` - 现有编辑器

### 修改文件
- `src/components/params/ImageUpload.tsx` - 集成编辑器
- `src/core/types/ParamDef.ts` - 添加编辑器配置

### 新建文件
- `src/components/params/__tests__/ImageUploadWithEditor.test.tsx` - 集成测试

## 验收标准

- [ ] ImageEditor 成功集成到 ImageUpload
- [ ] 上传后可以打开编辑器
- [ ] 编辑结果正确保存
- [ ] 可以重新编辑已上传图片
- [ ] 支持配置是否启用编辑器
- [ ] 用户体验流畅
- [ ] 集成测试通过

## 测试方法

### 测试1：自动打开编辑器
```typescript
const paramDef: ImageUploadParamDef = {
  id: 'image',
  component: 'image-upload',
  name: { zh: '图片', en: 'Image' },
  order: 1,
  maxCount: 1,
  uploadFormat: 'base64',
  editor: {
    enabled: true,
    autoOpen: true
  }
}

render(
  <ImageUpload
    {...paramDef}
    value={[]}
    onChange={mockOnChange}
  />
)

// 上传图片
const file = new File(['test'], 'test.png', { type: 'image/png' })
const input = screen.getByLabelText('上传图片')
fireEvent.change(input, { target: { files: [file] } })

// 等待编辑器打开
await waitFor(() => {
  expect(screen.getByTestId('image-editor')).toBeInTheDocument()
})
```

### 测试2：编辑并保存
```typescript
// 上传图片
const file = new File(['test'], 'test.png', { type: 'image/png' })
fireEvent.change(input, { target: { files: [file] } })

// 等待编辑器打开
await waitFor(() => {
  expect(screen.getByTestId('image-editor')).toBeInTheDocument()
})

// 执行编辑操作（裁剪）
fireEvent.click(screen.getByText('裁剪'))
// ... 编辑操作

// 保存
fireEvent.click(screen.getByText('保存'))

// 验证编辑结果
await waitFor(() => {
  expect(mockOnChange).toHaveBeenCalled()
  const savedImages = mockOnChange.mock.calls[0][0]
  expect(savedImages).toHaveLength(1)
  expect(savedImages[0]).toMatch(/^data:image/) // Base64
})
```

### 测试3：重新编辑
```typescript
// 已有上传的图片
render(
  <ImageUpload
    value={['data:image/png;base64,xxx']}
    onChange={mockOnChange}
    editor={{ enabled: true }}
  />
)

// 点击编辑按钮
const editButton = screen.getByLabelText('编辑图片')
fireEvent.click(editButton)

// 验证编辑器打开
await waitFor(() => {
  expect(screen.getByTestId('image-editor')).toBeInTheDocument()
})
```

### 测试4：取消编辑
```typescript
// 打开编辑器
fireEvent.change(input, { target: { files: [file] } })
await waitFor(() => {
  expect(screen.getByTestId('image-editor')).toBeInTheDocument()
})

// 取消
fireEvent.click(screen.getByText('取消'))

// 验证编辑器关闭且没有调用 onChange
expect(screen.queryByTestId('image-editor')).not.toBeInTheDocument()
expect(mockOnChange).not.toHaveBeenCalled()
```

## 风险与注意事项

### 风险
- 现有 ImageEditor 可能需要修改才能集成
- 编辑后的图片可能很大，影响性能

### 注意事项
- 保持现有 ImageEditor 的功能不变
- 编辑器应该是可选的，不是强制的
- 编辑后应该压缩图片（如果需要）
- 支持取消编辑，不改变原图
- 编辑历史应该在编辑器内部管理

## 配置接口设计

```typescript
// src/core/types/ParamDef.ts

interface ImageUploadParamDef extends BaseParamDef {
  component: 'image-upload'
  maxCount: number
  uploadFormat: 'base64' | 'url'
  base64WithPrefix?: boolean

  // 编辑器配置
  editor?: {
    enabled: boolean
    autoOpen?: boolean          // 上传后自动打开
    allowReEdit?: boolean        // 允许重新编辑
    maxWidth?: number            // 编辑后最大宽度
    maxHeight?: number           // 编辑后最大高度
    quality?: number             // 压缩质量 0-1
  }
}
```

## 集成实现参考

```typescript
// src/components/params/ImageUpload.tsx (部分代码)

import { ImageEditor } from '@/components/ImageEditor'

export const ImageUpload: React.FC<ImageUploadProps> = ({
  value = [],
  onChange,
  maxCount,
  uploadFormat,
  editor
}) => {
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingImage, setEditingImage] = useState<string | null>(null)
  const [editingIndex, setEditingIndex] = useState<number>(-1)

  // 上传完成
  const handleUpload = async (files: File[]) => {
    const newImages = await Promise.all(
      files.map(file => fileToDataURL(file))
    )

    // 如果启用编辑器且自动打开
    if (editor?.enabled && editor.autoOpen && newImages.length > 0) {
      setEditingImage(newImages[0])
      setEditingIndex(value.length)
      setEditorOpen(true)
    } else {
      onChange([...value, ...newImages])
    }
  }

  // 编辑保存
  const handleEditorSave = async (editedDataURL: string) => {
    const newValue = [...value]

    if (editingIndex >= 0 && editingIndex < newValue.length) {
      // 重新编辑现有图片
      newValue[editingIndex] = editedDataURL
    } else {
      // 新上传的图片
      newValue.push(editedDataURL)
    }

    onChange(newValue)
    setEditorOpen(false)
    setEditingImage(null)
  }

  // 重新编辑
  const handleReEdit = (index: number) => {
    if (editor?.enabled && editor.allowReEdit !== false) {
      setEditingImage(value[index])
      setEditingIndex(index)
      setEditorOpen(true)
    }
  }

  return (
    <>
      <div className="image-upload">
        {/* 上传区域 */}
        <UploadArea onUpload={handleUpload} />

        {/* 已上传图片列表 */}
        {value.map((img, index) => (
          <div key={index} className="uploaded-image">
            <img src={img} alt="" />
            {editor?.enabled && (
              <button onClick={() => handleReEdit(index)}>
                编辑
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 图片编辑器 */}
      {editorOpen && editingImage && (
        <ImageEditor
          image={editingImage}
          onSave={handleEditorSave}
          onCancel={() => setEditorOpen(false)}
          maxWidth={editor?.maxWidth}
          maxHeight={editor?.maxHeight}
          quality={editor?.quality}
        />
      )}
    </>
  )
}
```

## 回滚方案

1. 从 ImageUpload 组件中移除编辑器相关代码
2. 从 ParamDef 中移除 editor 配置
3. ImageEditor 保持独立，不集成
