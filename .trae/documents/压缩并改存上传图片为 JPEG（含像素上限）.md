## 目标
- 上传图片统一使用 Pica 进行高质量重采样与压缩，保存为 `jpg`；
- 保证总像素不超过 17,000,000，超出则按比例缩小；
- 与现有 `saveUploadImage` 调用完全兼容。

## 依赖
- 新增前端依赖：`pica`
  - 安装：`npm i pica`
  - 使用：`import pica from 'pica'`

## 改动范围
1. `src/utils/save.ts`
   - 新增：`ensureCompressedJpegBytesWithPica(blob: Blob, opts?: { maxPixels?: number; quality?: number })`
   - 修改：`saveUploadImage` 使用上面方法，改 `mime='image/jpeg'`、`ext='jpg'`
2. 其余文件无需改动（调用方与显示逻辑保持一致）

## 具体实现
- `ensureCompressedJpegBytesWithPica`：
  - 读取源图片：优先 `createImageBitmap(blob)`，失败则回退 `Image` 元素
  - 源画布 `srcCanvas` 尺寸为原始宽高
  - 计算像素上限：若 `w0 * h0 > 17_000_000`，则缩放因子 `s = sqrt(17_000_000 / (w0*h0))`，目标尺寸 `w = floor(w0*s)`、`h = floor(h0*s)`；否则保持原尺寸
  - 目标画布 `destCanvas` 尺寸为目标宽高
  - 使用 Pica：`await pica().resize(srcCanvas, destCanvas, { quality: 3, alpha: false })`
  - 导出 Blob：`const blob = await pica().toBlob(destCanvas, 'image/jpeg', quality)`，`quality` 默认 `0.85`
  - 将 Blob 转 `Uint8Array` 返回
- 更新 `saveUploadImage`：
  - 文件名：`upload-${hash}.jpg`
  - 若文件不存在，调用 Pica 压缩方法并写入；随后 `fileToBlobSrc(full, 'image/jpeg')` 与 `fileToDataUrl(full, 'image/jpeg')`

## 兼容性与注意事项
- 现有 `inferMimeFromPath` 与显示逻辑支持 JPG，无需改动
- EXIF 信息在重采样中会丢失，如需保留需引入 EXIF 库（可后续评估）
- Pica 在桌面端（Chromium）表现良好，质量与速度优于原生 `drawImage` 重采样

## 验证
- 上传 8K/4K/2K 图片，检查：
  - 保存扩展名为 `.jpg`
  - 宽高乘积不超过 17,000,000
  - 文件体积显著下降
- 历史与预览（`blob:`）显示正常

## 回滚方案
- 如出现兼容性问题，可快速将 `saveUploadImage` 回退到原生 `canvas.toDataURL('image/jpeg')` 实现（无依赖），再逐步优化

请确认使用 Pica 的方案；确认后我将按上述步骤实施并提交改动。