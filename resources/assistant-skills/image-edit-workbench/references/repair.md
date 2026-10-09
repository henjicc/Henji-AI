# 移除与指定来源修补

> 何时读：去掉杂物/路人、修复瑕疵、延续纹理、选择质量档，或处理模型下载与失败时读。

## 先决定填什么

| 意图 | 正式能力与边界 |
| --- | --- |
| 去掉物体，让背景自动补全 | `remove_image_edit_region`；默认自动质量，可显式 fast/fine |
| 同层有合适的干净纹理可借用 | `repair_image_edit_region`；sourceRegion 是来源中心，保持目标形状与尺寸；不下载模型 |
| 只想变透明或抠出主体 | `apply_image_edit_selection` 的 delete/copy/mask；不是修复填充 |

两种修复给实际像素层 targetRef，区域可用 kind=selection + ref（来自独立选区返回）或 kind=rectangle + 比例矩形。坐标是未裁剪画面，不是屏幕像素。移除还接受 kind=subject/portrait：唯一主体直接处理，多候选先用 `select_image_edit_region` 定位；尚未选定时 region.candidateId 用真实候选ID，已经选定时改用 selection 引用。指定来源修补不接受主体语义。

```json
{
  "tool": "remove_image_edit_region",
  "input": {
    "targetRef": {"kind": "image_edit.layer", "id": "v3:替换为像素层返回引用"},
    "region": {"kind": "selection", "ref": {"kind": "image_edit.selection", "id": "v3:替换为选区返回引用"}},
    "quality": "auto"
  }
}
```

```json
{
  "tool": "repair_image_edit_region",
  "input": {
    "targetRef": {"kind": "image_edit.layer", "id": "v3:替换为像素层返回引用"},
    "region": {"kind": "rectangle", "x": 0.4, "y": 0.4, "width": 0.1, "height": 0.1},
    "sourceRegion": {"x": 0.25, "y": 0.45}
  }
}
```

示例位置只演示结构，必须根据实际图像和目标选区改；来源与目标同层，不能把另一张图的坐标当来源。来源纹理应有相近透视、尺度和亮度，向目标内部羽化只是柔化接缝，不是 Poisson 光照匹配。quality 字段只影响自动移除，指定来源始终走经典搬运与融合。

## 质量与真实画质边界

- auto 根据遮罩实际面积与规则纹理选质量：很小瑕疵走经典修补，较大区域/周期纹理偏精细，其余快速。fast 通常 MI-GAN，fine 为 LaMa（当前精细路线用 CPU）。内部工作图尺寸是模型/内存约束，不是源图片或选区的产品尺寸上限。
- 大洞快速档可能生成错误结构、涂抹或丢细节；精细档更慢，也不能保证砖缝严格对齐、细发丝、文字恢复、4K/8K细节或任意纹理。已知砖墙补强减轻污染边缘，仍有轻微错位与局部模糊，不能把“提交成功”当画质达标。
- 遮罩未覆盖的残色会按像素保护保留；先修正选区，再换质量/来源，不反复对错选区生成。全选无已知背景时应缩小目标或指定干净来源，不能凭空保证内容。
- 两种修复仅标准色域适用，宽色域/HDR拒绝。只采样当前层及已有补丁，不二次烘焙上方调整；非选区和原alpha受保护，补丁进入原层，一次撤销，原图资源保留。
- 取消、来源/选区变化和实例关闭会拒绝迟到提交；单次底层推理未必能即时抢占，不能把取消等待当底层任务立即停止。

## 下载与失败恢复

沿 `local_model.item` 通用实体读 title/purpose、`local_model.item.size_mb`、`local_model.item.status`、`local_model.item.progress_percent`、`local_model.item.last_failure`。需要且授权允许时写 `local_model.item.downloaded`=true 下载并校验；通常首次算法会自动按需下载。写入返回不等于 ready，进度100%也不等于校验通过。下载源用 `local_model.settings.download_source`，不改网络配置或手填模型地址。

停止实际下载用 `cancel_local_model_download` 与返回模型引用；取消识别只丢本次迟到结果，不擅停共享下载。写 downloaded=false 会删除模型，不当作取消或普通重试。说明首次下载所需网络/磁盘与可能等待；本地模型不收云端生成费，但不扩大当前用户授权。

修复后回读返回 ref/documentRef 的实际状态，再取结果图看污染边缘、纹理接续与透明区，方法见 layers-export.md。失败先读恢复提示；保存未确认只恢复原操作保存，不重做移除，不启动云端付费替代。
