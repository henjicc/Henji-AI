# 全能调色调整层

> 何时读：全局调色、局部提亮、肤色/天空校正、曲线/色轮/HSL 或 LUT 时读。

## 先发现，再创建或修改

读取 `image_edit.document.color_mode` 与图层关系；对目标引用 describe 实例可用性，完整图片和画布编辑宿主支持共享调整层，快捷/蒙版宿主不能据此假定可用。

用 `change_application_entities` 创建 `image_edit.layer`：name、type=adjustment、definition_id=color_grade、params 为调整对象。正式属性为 `image_edit.layer.name`、`image_edit.layer.type`、`image_edit.layer.definition_id`、`image_edit.layer.params`。类型与定义创建后固定；已有调整只改 params，不另建“设置曝光”工具。

输入形状示例，引用必须替换为真实返回值；0.3 档只是可突破的审美起点。

```json
{
  "tool": "change_application_entities",
  "input": {
    "summary": "添加可编辑的提亮调整",
    "changes": [{
      "kind": "create_items",
      "entityType": "image_edit.layer",
      "parent": {"kind": "image_edit.document", "id": "v3:替换为文档返回引用"},
      "items": [{"properties": {
        "image_edit.layer.name": "基础提亮",
        "image_edit.layer.type": "adjustment",
        "image_edit.layer.definition_id": "color_grade",
        "image_edit.layer.params": {"exposure": 0.3}
      }}]
    }]
  }
}
```

读返回层引用再读 params；写 params 是整个对象替换，先保留现有字段再改所需项，不能只送一个字段而意外清掉其他校正。新层的省略项按 schema 中性默认；不要把默认补齐当成已有参数的合并语义。

## 与剪辑一致的参数意义

按 describe 的参数 schema 取真实字段、范围、默认和单位。基本校正、创意、RGB/色相曲线、三段色轮、HSL 二级、晕影、输入与 Look LUT 共用剪辑调色数学，但图片是静态参数，不写视频关键帧。

| 字段 | 意义与可突破的起点 |
| --- | --- |
| params.exposure | 线性曝光档，+1 亮度翻倍；轻微提亮可从 +0.3 起，按高光细节改 |
| params.temperature / params.tint | 正色温偏暖、负偏冷；正色调偏洋红、负偏绿；先围绕中性处微调 |
| params.saturation / params.vibrance | 饱和度 0 中性、-100 黑白、+100 翻倍；自然饱和度优先影响低饱和色 |
| params.shadow_hue / params.shadow_strength | 色相角配合强度，强度为0不染色；色轮只转色相不会自动生效 |
| params.curve_master_points | 图片用结构化 {x,y} 数组，x/y 为0–100百分比、x严格递增；空数组中性，非空至少两点 |
| params.hsl_hue_start / params.hsl_hue_end | 顺时针色相范围，可跨0°；肤色15–50°仅作观察起点，按真实肤色突破 |
| params.input_lut / params.look_lut | 已导入 .cube 的内容寻址资源标识，空字符串关闭；不接受路径、URL或剪辑 LUT 的短ID |

周期色相曲线两端 y 相等；HSL 饱和度/亮度范围起点不大于终点。图片 HSL 灰度观察属于会话预览，不写 params.hsl_show_mask，不进入保存/导出。查 params schema 而非复制视频 JSON 字符串曲线或动画字段。

LUT 由现有图片编辑器文件导入入口提供，助手不能捏造资源标识；只接受明确的 sRGB 工作空间/sRGB 传递函数。P3/PQ/HLG LUT 拒绝，不把普通 .cube 当 HDR/Log 转换。曝光等有宽色域/HDR支持，不代表全部高级校正与专业 HDR/Log 软件等价。图片自动校色/参考匹配入口尚未交付；助手可读图提出并写入参数，不冒用视频分析工具。

## 用选区控制调整范围

独立选区见 select.md；有选区时新建调整/效果层自动附带独立蒙版。已有层用 `apply_image_edit_selection` 的 action=mask 替换蒙版，先检查原蒙版避免覆盖用户精修。选区清除不等于清除已应用蒙版；HSL 键控也不等于独立几何选区。

回读 `image_edit.layer.mask_ref` 与 params，再实际看结果图。肤色、天空、商品色可以分别校正；不要把起点写成所有照片都必须遵守的配方。
