摘要：剪辑渲染里图片、文字、代码生成器目标、视频输入的固定上限全部改成“只作淘汰目标”，当前帧要的内容一律保留，不再抛错或溢出成位图。
图片按“序列尺寸 × 片段整段最大缩放”取 2 的幂档解码（长边不超过设备纹理上限），12000×8000 不再拒绝；各项缓存预算集中到 videoEditGpuBudget.ts 按显存与内存取值。
帧缓存改为按素材分桶、桶内按时间二分查找；去掉 8GiB 上限校验与 32 份、64 条、6 张等个数上限。

# 改动
- `videoEditGpuBudget.ts`：新增 `videoEditGpuBudgetFor({ dedicatedVideoMemoryBytes, systemMemoryBytes })` 与 `configureVideoEditGpuBudget`、`videoEditGpuBudget()`、`videoEditMaxTextureDimension()`。
  公式（显存 V、内存 R）：图片与文字 V/8、输入 V/16、代码驻留 V/16、三维 V/6、跳转常驻 V/24、帧缓存 min(V/3, R/8)、拖动闲置读取器 R/4GiB（4–16）、闲置声音（8–32）。
  RTX 4090 24GiB + 64GiB → 图片 3GiB、输入 1.5GiB、代码 1.5GiB、三维 4GiB、跳转 1GiB、帧缓存 8GiB、读取器 16、声音 16。
  读不到设备信息时沿用原来的数值（图片 1GiB、输入/代码 512MiB、三维 2GiB、跳转 384MiB、帧缓存 8GiB、4、8）。
  `VIDEO_EDIT_SPATIAL_WORKING_SET_BYTES` 改为 `export let` 实时绑定，三维两个文件不用改就跟着设备取值。
- `videoEditRenderer.ts`：
  - 新增 `videoEditImageDecodeScale`：图片片段按序列尺寸 × 整段最大缩放（含关键帧与非等比）取不小于需要的 2 的幂档，最大为源尺寸，长边 ≤ 纹理上限；代码引用、效果、三维、跟踪的按源尺寸（受纹理上限）。预览与导出都按序列尺寸取档，同一档位。
  - `image()` 带档位：已解码档位不够时重新解码（推近升档），`createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'high' })`；按实际位图记账。超预算先放拖动闲置的图，当前帧要的再放前瞻预解码的，当前帧的图一律保留。删 8192 边长拒绝、1GiB 抛错、可见 32 份抛错。
  - 构造选项新增 `device`（设备内存）；帧缓存默认值取预算，删除 8GiB 上限校验与“预览缓存预算无效”。
  - 代码视频输入：当前帧显示的不设上限；未显示的（即将进场的按出现先后、再前瞻预热的）共占 32 个名额，超出时排在后面的让出，不再抛“同时读取的视频画面超过32份”。
  - 定格画面存储、输入预算、闲置读取器/声音个数改取预算；拖动闲置图片不再限 6 张（由图片预算淘汰）。
- `videoEditGpuCompositor.ts`：设备就绪时登记 `maxTextureDimension2D`；纹理按实际栅格记账，超预算时销毁本帧不显示的纹理，不抛错；删“图片与文字超过32份”和“8192 像素或驻留预算”两处抛错；文字推近档位逐档降到纹理上限内（下限一倍）。
- `videoEditCodeGpu.ts`：字形缓存按字节淘汰（代码驻留预算），去掉 64 条上限；删 `generatorTargetCapacity`、`spillGeneratorTarget`（位图溢出路径）。
- `videoEditCodeSources.ts`：删溢出成位图再上传的循环与 `spilledPictures`；本帧要用的目标全部留在 GPU，之后不用的由 `releaseUnused` 释放。
- `videoEditFrameCache.ts`：按 mediaId 分桶、桶内按时间有序，`get` 二分查找；LRU 次序与淘汰规则不变。
- `videoEditJumpPreview.ts`：常驻画面预算取 `jumpPreviewBytes`。

# 验证
- 渲染层 tsc（经 heavy.sh）通过；改动的 13 个文件 eslint 通过。
- vitest：`videoEditFrameCache`、`videoEditJumpPreview`、`videoEditCodeSources`、`videoEditCodeGpu`、`videoEditGpuCompositor`、`videoEditRenderer` 全部通过（284 条）；真实 WebGPU（RTX 4090）`--mode gpu`：`videoEditContentPrecision.gpu`、`videoEditPlaybackResolution.gpu` 35 条通过。
- 每条的证据：
  - 图片：新增“超大图片不再拒绝…”——12000×8000 在 4K 序列按 0.5 档解码为 6000×4000，缩放关键帧推到 3 倍后升档为 8192×5461；“7 张 8192² 共 1.75GiB 超过预算照常画出”。
  - 文字与图片个数：合成器 33 张图片同帧 `prepareImages` 不抛错；4K 下 40 条文字同帧画出。
  - 代码目标：“同屏 12 个生成器的目标全部留在 GPU，不溢出成位图”。
  - 字形：64 条热字形加 1 条新的，只上传一次，旧字形不被条数挤掉（glyphs 65）。
  - 帧缓存：2000 帧乱序放入逐帧二分命中、空隙不命中、淘汰与删除后索引同步。
  - 视频输入 32 份：抛错删除，当前帧显示的输入不进名额限制（代码证据，未单独写测试）。
- 被删抛错文案全仓 grep：只剩 `docs/task/元宝搜索实战/问题记录.md` 的历史记录与排查表原文。
- 改掉的旧断言：缓存预算 9GiB 抛错、图片 1GiB 抛错、合成器 33 张抛错、字形 64 条、生成器容量 2 溢出位图、spill 目标下帧不命中、高精度目标 spill 返回 undefined——都是钉死旧上限或已删路径。

# 偏离
- “淘汰后仍超出就把非当前帧的图降一档”没有单独做：渲染器只留当前帧、前瞻预解码与拖动闲置三类图片，超预算时后两类直接淘汰，剩下的全是当前帧要的，不存在可降档的非当前帧图片。
- 文字没有改成字形图集：仍是每条文字一张纹理，只把记账改成实际栅格并去掉个数上限。
- 预算公式里帧缓存在 4090 + 64GiB 上仍是 8GiB（取 V/3 与 R/8 中较紧的）：解码帧多在显存，原生解码另占专用显存 3/4 作淘汰目标，再放大会和它抢显存。

# 第二轮（接线、纹理上限、补测试）
- 接线：`videoEditRenderTransport.ts` 新增 `videoEditDeviceMemory()`（界面进程只取一次，读不全不缓存）：`system.memoryInfo().totalBytes` 与硬件记录里各显卡 `dedicatedMemoryMiB` 的最大值；初始化处只插两处（取值一行、init 请求带 `device`）。`videoEditWorker.ts` init 带 `device` 传给渲染器。
  预览、导出、预渲染、指纹、源素材、多机位、录屏成片等都经 `VideoEditRenderSession` → 同一个 init，拿到同一份设备信息；嵌套与输入渲染器在同一 Worker 共用已配置的预算。`videoEditCodeInputProbe.ts` 直接建渲染器、不传设备，它只探测代码输入，不影响画面预算。
- 纹理上限：`deviceManager.ts` 的 requiredLimits 加 `maxTextureDimension2D`（取 adapter.limits，4090 为 16384）；`textRaster.ts` 的 `rasterizeText` 加 `maxDimension` 参数（缺省 8192，图片编辑不变），剪辑两处调用传设备上限；
  剪辑范围内其他写死 8192 的纹理判断改为设备上限：`videoEditCodeGpu.ts`（代码图片输入尺寸、文字目标档位）、`videoEditSpatialExposurePlan.ts`（三维栅格档位）、`videoEditGlyphMetrics.ts`（字形宽度）、合成器文字档位。
  没改：序列尺寸、图形画布、文字样式等文档格式里的 8192（持久格式与导出编码范围，不是纹理判断）；`core/videoEdit/codeMaterial/webSource.ts` 网页画面每边 8192 是作者代码的声明校验，要在任何机器上结果一致，保留。
- 补测试：取舍规则抽成 `videoEditCodeInputsKept`，新增“代码视频输入超过 32 份不报错：当前帧显示的全部保留（40 个）、未显示的按先后占剩余名额、最远的先让出”。
- 验证：渲染层 tsc（12288）通过；vitest 12 个文件 368 条通过（含 Worker、三维曝光计划、字形、文字栅格、设备管理器）；真实 WebGPU `--mode gpu` 4 个文件 39 条通过（ContentPrecision、PlaybackResolution、SpatialComposite、StyleCode）；改动文件 eslint 通过。

# 接线后 4090（24138MiB）+ 64GB 的实际预算
| 项 | 公式 | 数值 |
|---|---|---|
| 图片与文字纹理、解码图片、定格画面 | V/8 | 3017MiB ≈ 2.95GiB（原 1GiB） |
| 网页/视频输入与嵌套历史、前视 | V/16 | 1509MiB ≈ 1.47GiB（原 512MiB） |
| 代码驻留（生成器、效果目标、字形） | V/16 | 1509MiB（原 512MiB） |
| 三维推近工作集 | V/6 | 4023MiB ≈ 3.93GiB（原 2GiB） |
| 跳转常驻画面 | V/24 | 1006MiB（原 384MiB） |
| 节目帧缓存默认 | min(V/3, R/8) | 8046MiB ≈ 7.86GiB（原 8GiB，取显存一侧） |
| 拖动闲置读取器（浏览器回退） | R/4GiB，4–16 | 16（原 4） |
| 拖动闲置声音来源 | R/4GiB，8–32 | 16（原 8） |
| 单张纹理边长 | 设备上限 | 16384（原 8192） |

# 遗留
- 首次安装、硬件记录尚未生成时只拿到内存，显存一侧按默认值；记录生成后的下一个渲染会话起按实际显存。
- 字形单张四百万像素（`videoEditGlyphMetrics.ts` 的 MAX_PIXELS）仍会以 BUDGET 报错，本轮只放开了宽度。
- 需主会话验证：打开一个 4K 序列，放一张 12000×8000 图片和 10 张 5000 万像素照片拼贴，播放与导出都不报错；给其中一张加缩放关键帧到 300%，推近处人眼不发虚；4K 下放 40 条字幕和 12 个代码生成器同屏播放不报错。
