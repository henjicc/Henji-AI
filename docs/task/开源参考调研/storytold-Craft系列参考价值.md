# storytold（ArtCraft）Craft 系列：参考价值评估

> 调研日期：2026-10-22。仓库：https://github.com/storytold（组织名 ArtCraft）。
> 授权：各仓库均为 Apache-2.0 / MIT 双授权，可移植代码，保留署名并按 Apache 要求附 NOTICE。

## 总体判断

- 2026-09-30 起三周内批量开出十几个“纯 Rust 重写某款软件”的仓库，路线图以“Opus 5.5 代理小时”估算工作量，基本是 AI 代理写成。代码量大、测试多（soundcraft + filmcraft 约 4600 个测试），但处于 pre-alpha，未经真实用户检验。
- 它们是 egui 原生程序，我们是 Electron + 旁路程序：界面与整体架构不可搬，只借底层算法与模块。
- 用法：当作“可抄的算法参考库”，不做依赖。做到相关功能时挑模块移植进我们的 Rust 旁路程序或 WGSL，用我们自己的测试与 Reality 验收，提交正文写明来源。
- 价值排序：音频最高，图片次之（主要是 PSD），视频中等。

| 仓库 | 对标 | 规模（Rust 行） | 与我们相关的部分 |
|---|---|---|---|
| soundcraft | Pro Tools | 约 10 万 | `crates/vst3-host`、`clap-host`、`au-host`、`dsp` |
| filmcraft | Premiere Pro | 约 40 万 | `audio-dsp`、`interchange`、`platform`、`color`、`captions`、`edit`、`scopes` |
| effectcraft | After Effects | 约 39 万 | `keyframe`、`path`、`lottie`、`track`、`text` |
| photocraft | Photoshop | 约 63 万 | `psd`、`compose`、`cms`、`raw`、`paint`、`algo` |
| lightcraft | Lightroom | 约 32 万 | `inpaint`、`segment`、`lensdb`、`denoise`、`merge`、`pipeline` |
| craft-libs | 公共库 | 约 12 万 | 一般 |

## 音频

我们现状：自带频谱修复、去咔嗒、响度标准化、停顿检测；口播降噪/去口水音/呼吸控制依赖用户安装的 iZotope RX VST3；插件只在 Windows 扫描且只放行三款已验证 RX 处理器；VST3 用第三方 `vst3-host` 0.9，无插件界面。

| 可借鉴 | 位置 | 价值 | 说明 |
|---|---|---|---|
| 口播处理链：DeNoise（最小统计量追踪底噪的 STFT 谱门限，无需学习段）、DeHum、DeEsser（分频）、DeReverb（Polack 晚期混响模型谱减）、Enhance Speech、压缩器/扩展器/门、前瞻真峰值限制器、LPC 去咔嗒 | filmcraft `crates/audio-dsp/src/effects/{restoration,essential,dynamics,declick,stft}.rs` | 很高 | 移植进 `native/audio-worker` 即可去掉对 RX 的依赖，Mac 版首日可用 |
| BS.1770-4 / EBU R128 响度计（含 LRA，直方图门限） | filmcraft `audio-dsp/src/loudness.rs` | 中 | 核对我们响度标准化门限细节 |
| 自动闪避分析（灵敏度→阈值 `−20 − 4·s`、间隙合并、去毛刺） | filmcraft `audio-dsp/src/ducking.rs` | 中 | 对照我们已有闪避能力的参数语义 |
| VST3 托管：插件界面窗口（macOS NSWindow / Windows HWND）、组件与控制器状态打包保存、各家插件模块退出崩溃坑、测试用假插件 | soundcraft `crates/vst3-host`（约 5000 行） | 高 | 放开非 RX 插件、做 Mac 版前对照。我们一请求一进程的崩溃隔离比它同进程托管更稳，保留 |
| AU、CLAP 托管 | soundcraft `au-host`、`clap-host` | 低 | Mac 上真有需要再看 |

## 视频

我们现状：WebGPU 合成、LUT、校色、角点贴合、跟踪、智能区域、多机位、重构画幅、助手颜色统计与自动校色/镜头匹配均已具备，这些对方不比我们强。视频解码服务只有 Windows（D3D11VA），`native/video-decoder/src/platform/mod.rs` 已预留 `platform/macos/`。

| 可借鉴 | 位置 | 价值 | 说明 |
|---|---|---|---|
| 时间线交换：CMX 3600 EDL、FCP7 XML（xmeml，PR 读写）、FCPXML 1.9–1.11、OTIO | filmcraft `crates/interchange`（约 1.5 万行） | 高 | PR 工程导入、粗剪交回 PR。我们只有音频 XML |
| VideoToolbox 硬解（含 IOSurface/CVPixelBuffer） | filmcraft `crates/platform/src/videotoolbox.rs`（约 570 行） | 高（Mac 版时） | 实现 `platform/macos/` 时对照 |
| 摄影机 Log 曲线、色域与色调映射、色彩元数据 | filmcraft `crates/color` | 中 | 专业素材导入后不再发灰 |
| 专业字幕格式 SCC、TTML/IMSC1、EBU STL、MCC，宽容读取 | filmcraft `crates/captions` | 中低 | 我们已有 SRT/VTT |
| 按 PR 语义的编辑代数（覆盖、插入、四种修剪） | filmcraft `crates/edit` | 中 | 逐条核对我们的修剪行为 |
| 示波器统计的“给智能体的数值摘要” | filmcraft `crates/scopes` | 低 | 我们已有颜色读数能力 |
| AE 关键帧语义（速度 + 影响度）、路径操作（修剪路径、偏移、合并、布尔） | effectcraft `crates/keyframe`、`crates/path` | 中 | 形状层与动态图形时对照 |
| Lottie 导入导出 | effectcraft `crates/lottie` | 中 | 代码素材动效导出给网页/App，或导入现成动画 |
| 自研 H.264/HEVC/AV1/ProRes 编解码、AE 表达式引擎 | filmcraft codec crates、effectcraft `expr` | 不借 | 我们用 ffmpeg + 硬解；代码效果已定走标准 ES 模块 |

## 图片

我们现状：本地模型已有 EfficientTAM 点/框主体选择、LaMa/MI-GAN 修补、YuNet 人脸、抠像、文字检测，LUT、自动校色、颜色读数；没有 PSD 导入导出，没有相机 RAW。

| 可借鉴 | 位置 | 价值 | 说明 |
|---|---|---|---|
| PSD/PSB 无损读写 + PS 图层语义参考合成器（混合模式、蒙版密度、填充不透明度） | photocraft `crates/psd`（约 1.8 万行）、`crates/compose` | 很高 | PS 迁移与商品图交付的硬门槛 |
| ICC v2/v4 色彩管理（含 CMYK↔Lab、黑点补偿） | photocraft `crates/cms` | 中高 | 印刷交付与带配置文件图片的正确显示 |
| 相机 RAW 解码与显影、lensfun 格式镜头校正 | photocraft `crates/raw`、lightcraft `crates/lensdb`、`pipeline` | 中 | 工作量大，排在 PSD 后 |
| PatchMatch 多尺度修补 | lightcraft `crates/inpaint` | 中 | 不下载模型的免费兜底、大面积纹理 |
| 数据化笔刷引擎（笔触可录制回放，抖动由种子决定） | photocraft `crates/paint` | 中 | 笔刷升级时参考，符合可调用、可复现 |
| SAM 3 文字提示概念分割 | lightcraft `crates/segment` | 理念高，落地低 | 模型约 3GB，超出百 MB 量级边界；记下方向，等小模型 |
| HDR 合成、全景拼接 | lightcraft `crates/merge` | 低 | 不在北极星场景内 |

## 方法上可学的

1. 对标清单量化：脚本逐个菜单项对照目标软件，给出覆盖百分比与剩余工作量（各仓库 `docs/parity-checklist.md`、`target-app-parity.md`）。
2. 一个算法一份性能记录（photocraft `docs/*-performance.md`）。
3. “永不崩溃”边界：`unsafe` 只允许在私有 ffi 模块，公共接口一律返回错误、不 panic（soundcraft `vst3-host` 头注释）。

## 建议推进顺序（待用户确认）

1. 内置口播处理链（音频处理程序）—— 补齐场景 A，去掉付费插件依赖。
2. PSD 导入导出 —— 场景 C 与 PS 迁移门槛。
3. PR 时间线交换（FCP7 XML 优先，其次 OTIO）。
4. Mac 版时：VideoToolbox 解码、VST3 插件界面与状态。
5. Log 曲线与色彩管理、ICC/CMYK、RAW。

纯技术移植适合交 Codex 各开 worktree 并行；界面接入由 Claude 做。
