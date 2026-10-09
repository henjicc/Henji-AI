# 独立选区、主体与人像

> 何时读：圈定局部、抠主体、精修边缘、组合选区、羽化，或多个主体需要消歧时读。

## 形状、组合与边缘

列出 `image_edit.selection` 取引用，读写 `image_edit.selection.region`。它是每份打开文档的会话选区，独立于图层蒙版；关闭后清理，不是持久作品。完整/画布编辑宿主提供框选、椭圆、自由套索、多边形套索与画笔手势；套索都用 points，画笔多加 radius。

region 对象为 operations、feather、inverted；operations 每项是 shape、combine 与可选 invertBefore。shape.type 为 rectangle/ellipse/lasso/brush，算法还会返回 mask 形状。坐标属于未裁剪文档画面，x/y/width/height 为0–1比例；画笔半径与羽化是画面短边比例，不是屏幕像素。不要手工构造模型遮罩，保留算法实际返回的 region。

组合为 replace 新选、add 并集、subtract 减去、intersect 交集；追加形状时先读并保留原 operations。已有反选后追加组合必须保存其语义（invertBefore），不会处理时优先用算法的 combine，不能丢掉原反选。feather 是非累计羽化，改值重新求值；inverted 控制整体反选，写 null 取消。羽化可从短边0.002起，硬边商品或细发丝按结果突破，仍须满足schema。

以下只有输入形状，真实引用取返回值。

```json
{
  "tool": "change_application_entities",
  "input": {
    "summary": "框选局部并柔化边缘",
    "changes": [{
      "kind": "set_properties",
      "entityType": "image_edit.selection",
      "target": {"kind": "image_edit.selection", "id": "v3:替换为选区返回引用"},
      "properties": {"image_edit.selection.region": {
        "operations": [{"shape": {"type": "rectangle", "x": 0.2, "y": 0.2, "width": 0.4, "height": 0.5}, "combine": "replace"}],
        "feather": 0.002,
        "inverted": false
      }}
    }]
  }
}
```

## 主体算法与候选

`select_image_edit_region` 给 targetRef（实际像素层），region.kind=subject/portrait/point/box，combine 默认为 replace。portrait 可给 quality=fine/fast；point 的 points 每点含 x/y/foreground（true正点、false负点），box 给比例矩形。画面比例不是图层局部坐标，不猜坐标偏移。

```json
{
  "tool": "select_image_edit_region",
  "input": {
    "targetRef": {"kind": "image_edit.layer", "id": "v3:替换为像素层返回引用"},
    "region": {"kind": "portrait", "quality": "fine"},
    "combine": "replace"
  }
}
```

- status=selected 才表示选区已写入，读返回 ref 的 region 核对；status=candidates 只返回候选、不改选区。按 candidates 中 id、bounds、area、score 和实际图像定位，candidateId 必须来自本次返回。
- 歧义时同一个 targetRef/region 再给顶层 candidateId；图片、图层或选区变化/撤销后候选过期，重新识别。按用户描述能定位就自主选，不能区分才请用户按位置明确目标，不静默挑最高分。
- 通用主体复用 EfficientTAM：一键粗网格可能漏图边小物体、返回背景或物体局部；改用点框与负点细化。人像精细优先 RVM，快速 Selfie，失败按正式回退处理；软边可保留但不承诺全部极细发丝或身份识别。标准色域适用；先看能力可用性。
- 算法采样当前像素层及已有补丁，不烘焙上方调整或蒙版。取消/文档变化会拒绝迟到结果；首次可能下载模型，见 repair.md。

## 把选区用于作品

`apply_image_edit_selection` 给 targetRef 和 action：mask 替换该层蒙版；copy 将当前像素层所选内容复制到新层；delete 删除所选内容为透明，不是内容填充。复制/删除保留原蒙版可见范围，返回真实图层 ref，一次作品修改一次撤销。有选区时新建调整/效果层也自动带蒙版。

先读目标与原蒙版，应用后回读蒙版或新层并实际看透明边缘。扩展/收缩选区尚未在本轮交付，不发明工具；需要更宽区域时调整形状或加选。
