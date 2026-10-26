import type { LocalizedText, LocalModelId } from '../../../../src/platform/contracts/localModels'
import type { DownloadRegion } from '../download/sourceSelector'

/*
 * 本地模型清单（任务 4.11）：每个文件的大小与 SHA-256 写死在这里，按官方文件实际计算
 * （2026-10-06 从官方源下载核对，各 ModelScope 镜像同名文件哈希一致，记录见任务文件 4.11）。
 * 任何源下载到的文件都按这里校验，镜像被替换或损坏会被拒绝。
 *
 * 下载源按区域分组，同一区域内按顺序尝试：
 * - 国内首选我们自己的 ModelScope 仓库（OWN_MODELSCOPE_REPO，上传前不存在，探测到 404 会自动换下一个）；
 *   其次是现有的第三方 ModelScope 镜像（个人仓库可能失效，所以只作备用）。
 * - 国外用官方 Hugging Face / GitHub。
 *
 * 新增模型：在 `src/platform/contracts/localModels.ts` 的 LOCAL_MODEL_IDS 登记 ID，再在这里补一条。
 */

/** 我们自己的 ModelScope 模型仓库（用户上传后生效）。目录结构见任务文件 4.11 的上传清单。 */
export const OWN_MODELSCOPE_REPO = 'henjicc/henji-ai-local-models'

export function modelScopeUrl(repo: string, file: string): string {
  return `https://www.modelscope.cn/models/${repo}/resolve/master/${file}`
}

function ownUrl(file: string): string {
  return modelScopeUrl(OWN_MODELSCOPE_REPO, file)
}

function huggingFaceUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}`
}

/**
 * UVR 的 MDX-Net 模型（人声分离 Kim_Vocal_2、去混响 Reverb_HQ_By_FoxJoy）：UVR 官方模型仓库 TRvlvr/model_repo 只发布文件，
 * 没有许可证声明；Hugging Face 镜像 Politrees/UVR_resources 卡片写 MIT，但那是镜像仓库的声明，不代表模型作者授权。
 * 因此许可证记为 NOASSERTION，分发前需要人工向作者确认（2026-10-26 核对）。
 * 国内为我们的 ModelScope 仓库（上传后生效），国外固定镜像版本（2025-12-23），两个文件的大小与 SHA-256 与镜像一致。
 */
const UVR_RESOURCES_REVISION = '929e057b81aa49bc2e6490bef8671f47b2c120f6'
const UVR_MODEL_LICENSE: LocalModelLicense = { spdx: 'NOASSERTION', url: 'https://github.com/TRvlvr/model_repo' }
function uvrMdxFile(name: string, sizeBytes: number, sha256: string): LocalModelFileSpec {
  return { name, role: 'model', sizeBytes, sha256, sources: [
    { region: 'domestic', label: 'own-modelscope', url: ownUrl(`audio_separation_mdx/${name}`) },
    { region: 'global', label: 'huggingface', url: `https://huggingface.co/Politrees/UVR_resources/resolve/${UVR_RESOURCES_REVISION}/models/MDXNet/${name}` },
  ] }
}

/** Xenova/larger_clap_general 固定版本（2024-10-08），各文件哈希与我们的 ModelScope 仓库一致。 */
const CLAP_XENOVA_REVISION = 'd78c3994912c441f0151a5cc44d86f6b7bf4c861'
/** 听音模型 CLAP 的一个文件：国内为我们的 ModelScope 仓库，国外为 Xenova 的 Hugging Face 导出。 */
function clapFile(name: string, role: LocalModelFileSpec['role'], sizeBytes: number, sha256: string, upstream: string): LocalModelFileSpec {
  return { name, role, sizeBytes, sha256, sources: [
    { region: 'domestic', label: 'own-modelscope', url: ownUrl(`audio_understanding_clap/${name}`) },
    { region: 'global', label: 'huggingface-xenova', url: `https://huggingface.co/Xenova/larger_clap_general/resolve/${CLAP_XENOVA_REVISION}/${upstream}` },
  ] }
}

/** musetric/beat-this-onnx 固定版本（2026-10-08，1500 帧静态图，与官方 PyTorch 参考逐拍一致）。 */
const BEAT_THIS_REVISION = '25308706dda545c0d5950065bb0604ad71bcf1f5'
/** 节拍模型 Beat This! 的一个文件：国内为我们的 ModelScope 仓库，国外为 musetric 的 Hugging Face 导出。 */
function beatThisFile(name: string, role: LocalModelFileSpec['role'], sizeBytes: number, sha256: string): LocalModelFileSpec {
  return { name, role, sizeBytes, sha256, sources: [
    { region: 'domestic', label: 'own-modelscope', url: ownUrl(`music_beats_beat_this/${name}`) },
    { region: 'global', label: 'huggingface-musetric', url: `https://huggingface.co/musetric/beat-this-onnx/resolve/${BEAT_THIS_REVISION}/${name}` },
  ] }
}

export interface LocalModelSource {
  region: DownloadRegion
  /** 日志里区分来源用（不展示给用户）。 */
  label: string
  url: string
}

export interface LocalModelFileSpec {
  /** 存到本地的文件名。 */
  name: string
  role: 'model' | 'dict' | 'config'
  sizeBytes: number
  sha256: string
  sources: readonly LocalModelSource[]
}

export interface LocalModelLicense {
  /** SPDX 简称。 */
  spdx: string
  url: string
}

export interface LocalModelSpec {
  id: LocalModelId
  title: LocalizedText
  purpose: LocalizedText
  /** 本地文件夹名（按作品目录的分类文件夹语言取用）。 */
  folderName: LocalizedText
  /** 原始项目主页（写进说明文件）。 */
  homepage: string
  license: LocalModelLicense
  /** `pending`：还没有可下载的文件（需要另行导出），列表里显示为“暂不可下载”。 */
  availability: 'available' | 'pending'
  files: readonly LocalModelFileSpec[]
}

/** 自动选源时的探测地址：只看连通性，任何 HTTP 响应都算可达。 */
export const LOCAL_MODEL_SOURCE_PROBES: Readonly<Record<DownloadRegion, string>> = {
  domestic: 'https://www.modelscope.cn/',
  global: 'https://huggingface.co/',
}

export const LOCAL_MODEL_MANIFEST: readonly LocalModelSpec[] = [
  {
    id: 'image_inpainting_migan',
    title: { zh: '图片修补 MI-GAN', en: 'Image Inpainting MI-GAN' },
    purpose: { zh: '在本机移除图片中选定的物体或瑕疵，适合快速修补', en: 'Locally removes selected objects or blemishes for fast image repair' },
    folderName: { zh: '图片修补 MI-GAN', en: 'Image Inpainting MI-GAN' },
    homepage: 'https://github.com/Picsart-AI-Research/MI-GAN',
    license: { spdx: 'MIT', url: 'https://github.com/Picsart-AI-Research/MI-GAN/blob/main/LICENSE-WEIGHTS' },
    availability: 'available',
    files: [{
      name: 'migan.onnx', role: 'model', sizeBytes: 29_546_882,
      sha256: '593eba0b7e04730f1b61c0a3cbca68d97d8d6a7ff5c6a44a7b9d7fcd880fc5ae',
      sources: [
        // 镜像即使尚未上传也会按现有选择器回退，下载必须经过上面的字节/哈希校验。
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('image_inpainting_migan/migan.onnx') },
        { region: 'global', label: 'huggingface-author', url: 'https://huggingface.co/andraniksargsyan/migan/resolve/406830d0fa60666da0071c342ad2fbc8f30c5c64/migan.onnx' },
      ],
    }],
  },
  {
    id: 'image_inpainting_lama',
    title: { zh: '图片修补 LaMa', en: 'Image Inpainting LaMa' },
    purpose: { zh: '在本机修补较大区域与重复纹理，可按需要另行下载', en: 'Locally repairs larger regions and repeating textures; downloaded on demand' },
    folderName: { zh: '图片修补 LaMa', en: 'Image Inpainting LaMa' },
    homepage: 'https://github.com/Carve-Photos/lama',
    license: { spdx: 'Apache-2.0', url: 'https://github.com/Carve-Photos/lama/blob/main/LICENSE' },
    availability: 'available',
    files: [{
      name: 'lama_fp32.onnx', role: 'model', sizeBytes: 208_044_816,
      sha256: '1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('image_inpainting_lama/lama_fp32.onnx') },
        { region: 'global', label: 'huggingface-carve', url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx' },
      ],
    }],
  },
  {
    id: 'face_detection_yunet',
    title: { zh: '人脸检测 YuNet', en: 'Face Detection (YuNet)' },
    purpose: { zh: '找出画面中的人脸，用于人脸打码与人脸区域', en: 'Finds faces for face blur and face regions' },
    folderName: { zh: '人脸检测 YuNet', en: 'Face Detection YuNet' },
    homepage: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet',
    license: { spdx: 'MIT', url: 'https://github.com/opencv/opencv_zoo/blob/main/models/face_detection_yunet/LICENSE' },
    availability: 'available',
    files: [{
      name: 'face_detection_yunet_2023mar.onnx',
      role: 'model',
      sizeBytes: 232_589,
      sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('face_detection_yunet/face_detection_yunet_2023mar.onnx') },
        { region: 'domestic', label: 'modelscope-mirror', url: modelScopeUrl('FlynnDu/novaber-privacy-redaction-yunet', 'face_detection_yunet_2023mar.onnx') },
        { region: 'global', label: 'huggingface-opencv', url: huggingFaceUrl('opencv/face_detection_yunet', 'face_detection_yunet_2023mar.onnx') },
        { region: 'global', label: 'github-opencv-zoo', url: 'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx' },
      ],
    }],
  },
  {
    id: 'person_matting_rvm',
    title: { zh: '人物抠像 RVM', en: 'Person Matting (RVM)' },
    purpose: { zh: '把人物从视频背景中抠出，边缘稳定不闪，用于抠像与背景虚化', en: 'Separates people from video backgrounds for matting and background blur' },
    folderName: { zh: '人物抠像 RVM', en: 'Person Matting RVM' },
    homepage: 'https://github.com/PeterL1n/RobustVideoMatting',
    license: { spdx: 'GPL-3.0', url: 'https://github.com/PeterL1n/RobustVideoMatting/blob/master/LICENSE' },
    availability: 'available',
    files: [{
      name: 'rvm_mobilenetv3_fp16.onnx',
      role: 'model',
      sizeBytes: 7_503_483,
      sha256: '6a0d5ce6cc17702613be548559879b4521ed424cfe14ddc48d1acaa44d616f64',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('person_matting_rvm/rvm_mobilenetv3_fp16.onnx') },
        { region: 'domestic', label: 'modelscope-mirror', url: modelScopeUrl('ymfjly/RVM_GUI_DependentModels', 'rvm_mobilenetv3_fp16.onnx') },
        { region: 'global', label: 'github-release', url: 'https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp16.onnx' },
      ],
    }],
  },
  {
    id: 'selfie_segmentation',
    title: { zh: '快速人像分割 MediaPipe', en: 'Fast Selfie Segmentation (MediaPipe)' },
    purpose: { zh: '快速区分人物与背景，用于预览和配置较低的电脑', en: 'Quick person/background split for previews and low-end machines' },
    folderName: { zh: '快速人像分割 MediaPipe', en: 'Selfie Segmentation MediaPipe' },
    homepage: 'https://huggingface.co/onnx-community/mediapipe_selfie_segmentation',
    license: { spdx: 'Apache-2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
    availability: 'available',
    files: [{
      name: 'mediapipe_selfie_segmentation_fp16.onnx',
      role: 'model',
      sizeBytes: 251_097,
      sha256: '3b2a53a26b6e7c00b5e2415443e45dfa8c66c62bd496f7f2ee7dcf9ce47dea4f',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('selfie_segmentation/mediapipe_selfie_segmentation_fp16.onnx') },
        { region: 'domestic', label: 'modelscope-mirror', url: modelScopeUrl('onnx-community/mediapipe_selfie_segmentation', 'onnx/model_fp16.onnx') },
        { region: 'global', label: 'huggingface-onnx-community', url: huggingFaceUrl('onnx-community/mediapipe_selfie_segmentation', 'onnx/model_fp16.onnx') },
      ],
    }],
  },
  {
    id: 'object_tracking_vittrack',
    title: { zh: '物体框跟踪 VitTrack', en: 'Box Tracking (VitTrack)' },
    purpose: { zh: '框选一个物体后逐帧跟随它的位置，用于让文字、贴纸或效果跟着物体走', en: 'Follows a boxed object frame by frame so text, stickers or effects can move with it' },
    folderName: { zh: '物体框跟踪 VitTrack', en: 'Box Tracking VitTrack' },
    homepage: 'https://github.com/opencv/opencv_zoo/tree/main/models/object_tracking_vittrack',
    license: { spdx: 'Apache-2.0', url: 'https://github.com/opencv/opencv_zoo/blob/main/models/object_tracking_vittrack/LICENSE' },
    availability: 'available',
    files: [{
      name: 'object_tracking_vittrack_2023sep.onnx',
      role: 'model',
      sizeBytes: 714_726,
      sha256: '2990f0b7cd44d92afa48cd97db6de7be113fc1d9594fddb74e2725c10478e91d',
      sources: [
        { region: 'domestic', label: 'own-modelscope', url: ownUrl('object_tracking_vittrack/object_tracking_vittrack_2023sep.onnx') },
        { region: 'global', label: 'huggingface-opencv', url: huggingFaceUrl('opencv/object_tracking_vittrack', 'object_tracking_vittrack_2023sep.onnx') },
        { region: 'global', label: 'github-opencv-zoo', url: 'https://github.com/opencv/opencv_zoo/raw/main/models/object_tracking_vittrack/object_tracking_vittrack_2023sep.onnx' },
      ],
    }],
  },
  {
    id: 'object_tracking_efficienttam',
    title: { zh: '任意物体跟踪 EfficientTAM', en: 'Object Tracking (EfficientTAM)' },
    purpose: { zh: '点选或框选任意物体后整段跟踪', en: 'Tracks any clicked or boxed object through a clip' },
    folderName: { zh: '任意物体跟踪 EfficientTAM', en: 'Object Tracking EfficientTAM' },
    homepage: 'https://github.com/yformer/EfficientTAM',
    license: { spdx: 'Apache-2.0', url: 'https://github.com/yformer/EfficientTAM/blob/main/LICENSE' },
    // 官方没有 ONNX，由我们从官方权重 efficienttam_ti_512x512.pt 导出（opset 17，fp32），
    // 拆成图像编码、提示与掩码解码、记忆编码、记忆注意力、遮罩缩小五个部件；
    // 张量名、形状与记忆库约定（最多 7 帧记忆、16 个目标指针）见上传目录的 SOURCE.md。
    availability: 'available',
    files: [
      {
        name: 'efficienttam_ti_512_image_encoder.onnx',
        role: 'model',
        sizeBytes: 25_447_190,
        sha256: '19db98cdac060653581616354ce899814cd942ffa3a3620f26551ca8bad85673',
        // 我们从官方权重导出（官方没有 ONNX），只放在自有仓库；国外用户同样从 ModelScope 下载
        sources: [{ region: 'domestic', label: 'own-modelscope', url: ownUrl('object_segmentation_efficienttam/efficienttam_ti_512_image_encoder.onnx') }],
      },
      {
        name: 'efficienttam_ti_512_mask_decoder.onnx',
        role: 'model',
        sizeBytes: 18_789_601,
        sha256: '9d99ae7805d3501262987a66d901fbe612f9a0b80291c5182eae7ba89bff1b64',
        // 我们从官方权重导出（官方没有 ONNX），只放在自有仓库；国外用户同样从 ModelScope 下载
        sources: [{ region: 'domestic', label: 'own-modelscope', url: ownUrl('object_segmentation_efficienttam/efficienttam_ti_512_mask_decoder.onnx') }],
      },
      {
        name: 'efficienttam_ti_512_memory_encoder.onnx',
        role: 'model',
        sizeBytes: 5_575_013,
        sha256: '594b11773d2b281e78bb761b48a6476e46e9571ebdc6fc8ba02216cde60fbbf4',
        // 我们从官方权重导出（官方没有 ONNX），只放在自有仓库；国外用户同样从 ModelScope 下载
        sources: [{ region: 'domestic', label: 'own-modelscope', url: ownUrl('object_segmentation_efficienttam/efficienttam_ti_512_memory_encoder.onnx') }],
      },
      {
        name: 'efficienttam_ti_512_memory_attention.onnx',
        role: 'model',
        sizeBytes: 26_112_634,
        sha256: '8afa10463d201d11a83af4e01a3eaac00d29e85d11f473d9b1c676c9876b8bda',
        // 我们从官方权重导出（官方没有 ONNX），只放在自有仓库；国外用户同样从 ModelScope 下载
        sources: [{ region: 'domestic', label: 'own-modelscope', url: ownUrl('object_segmentation_efficienttam/efficienttam_ti_512_memory_attention.onnx') }],
      },
      {
        name: 'efficienttam_ti_512_mask_downsample.onnx',
        role: 'model',
        sizeBytes: 511,
        sha256: 'dd420a9790973a249fdc559cd9b192e8c798e96e40d78e5b7d75d8a47a2cb84f',
        // 我们从官方权重导出（官方没有 ONNX），只放在自有仓库；国外用户同样从 ModelScope 下载
        sources: [{ region: 'domestic', label: 'own-modelscope', url: ownUrl('object_segmentation_efficienttam/efficienttam_ti_512_mask_downsample.onnx') }],
      },
    ],
  },
  {
    id: 'audio_understanding_clap',
    title: { zh: '听音模型 CLAP', en: 'Audio Understanding (CLAP)' },
    purpose: { zh: '听懂音效的声音特点，让音效库能按“短促的嗖”“清脆的叮”之类的描述找音效', en: 'Understands how sound effects sound so the sound library can be searched by description' },
    folderName: { zh: '听音模型 CLAP', en: 'Audio Understanding CLAP' },
    homepage: 'https://huggingface.co/laion/larger_clap_general',
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/laion/larger_clap_general' },
    availability: 'available',
    // Xenova 的 fp16 ONNX 导出（输入输出仍为 float32）；与 fp32 检索前 10 重合 96%，int8 只有 86%。
    // 我们的 ModelScope 仓库与 Hugging Face 同名文件逐字节一致（2026-10-21 核对 SHA-256）。
    files: [
      clapFile('larger_clap_general_audio_fp16.onnx', 'model', 143_432_227, '7331cfbef5e9b7eec56e489c93737556f5e22c8abf8978280f0ad38c4b2b1ed1', 'onnx/audio_model_fp16.onnx'),
      clapFile('larger_clap_general_text_fp16.onnx', 'model', 251_029_088, '9c06f2aa8b7da59c3a781c682cbca510206d198e2d0c9ebadb78927e38df7f94', 'onnx/text_model_fp16.onnx'),
      clapFile('tokenizer.json', 'config', 2_108_774, 'dc239041d98de27ffc3975473a1a23e3db4c937b23c138c38bbc66588bd247e5', 'tokenizer.json'),
      clapFile('tokenizer_config.json', 'config', 1_392, '2c964a338683aec3695ea37687271e75b40905233f5d2a5bbb9be8cb40c4d0a0', 'tokenizer_config.json'),
      clapFile('preprocessor_config.json', 'config', 541, '9739f58296aa6f9ac18008fd0150fb2649bc554985fbde86d0a4041c882ac753', 'preprocessor_config.json'),
      clapFile('config.json', 'config', 587, 'b8c3a259af1c9eee98570630d81881974a368364886678d9c6b04c6d15874837', 'config.json'),
    ],
  },
  {
    id: 'music_beats_beat_this',
    title: { zh: '节拍模型 Beat This!', en: 'Beat Tracking (Beat This!)' },
    purpose: { zh: '准确找出音乐的拍子与小节，用于音频重构（把音乐自动拼接到指定时长）', en: 'Finds beats and bars in music for remixing a track to a target duration' },
    folderName: { zh: '节拍模型 Beat This', en: 'Beat Tracking Beat This' },
    homepage: 'https://github.com/CPJKU/beat_this',
    // 代码与权重均为 MIT（CPJKU 仓库 LICENSE 与 README “License” 一节；ONNX 导出仓库沿用 MIT）。
    license: { spdx: 'MIT', url: 'https://github.com/CPJKU/beat_this/blob/main/LICENSE' },
    availability: 'available',
    // 官方 final0 检查点（sha256 8c328b45…）的 fp32 ONNX；梅尔滤波器组是 torchaudio MelScale.fb 原样导出。
    files: [
      beatThisFile('beat_this.onnx', 'model', 190_649_026, '1337dc6c21257ed6b803418efc320df42b5d8eb296ef16648ef60457cd4b9e55'),
      beatThisFile('mel-filterbank.bin', 'config', 262_656, '1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533'),
      beatThisFile('config.json', 'config', 1_012, '966f271e9a44c8f1b9e438622b34165ecdf6df9adedc8a9c0a6f7fd9d3458cc2'),
    ],
  },
  {
    id: 'speech_breath_respiro',
    title: { zh: '呼吸声检测 Respiro', en: 'Breath Detection (Respiro)' },
    purpose: { zh: '逐帧找出口播里的呼吸声，用于口播剪辑自动删除或减弱呼吸、挑选气口', en: 'Finds breaths frame by frame in voice recordings so talking-head edits can remove or soften them and cut at natural breaths' },
    folderName: { zh: '呼吸声检测 Respiro', en: 'Breath Detection Respiro' },
    homepage: 'https://github.com/ydqmkkx/Respiro-en',
    // 代码与权重均为 MIT（仓库 LICENSE，Copyright 2024 DongYANG）。官方只发布 PyTorch 检查点，
    // 这里的 ONNX 由我们把特征提取（STFT、梅尔、dB、方差、过零率）与模型一起导出，与官方实现逐帧一致；只有自有仓库可下载。
    license: { spdx: 'MIT', url: 'https://github.com/ydqmkkx/Respiro-en/blob/main/LICENSE' },
    availability: 'available',
    files: [{
      name: 'respiro-en.onnx', role: 'model', sizeBytes: 12_867_269,
      sha256: '293b7c60da233256f7aa37e73d058e3f5dd444ba3d242d6909eab2c0d94478a8',
      sources: [{ region: 'domestic', label: 'own-modelscope', url: ownUrl('speech_breath_respiro/respiro-en.onnx') }],
    }],
  },
  {
    id: 'audio_separation_kim_vocal_2',
    title: { zh: '人声分离 Kim Vocal 2', en: 'Vocal Separation (Kim Vocal 2)' },
    purpose: { zh: '把人声与伴奏、背景声分开，用于提取干净人声或去掉人声留下伴奏', en: 'Separates vocals from music and background sound to isolate a clean voice or keep only the accompaniment' },
    folderName: { zh: '人声分离 Kim Vocal 2', en: 'Vocal Separation Kim Vocal 2' },
    homepage: 'https://github.com/Anjok07/ultimatevocalremovergui',
    license: UVR_MODEL_LICENSE,
    availability: 'available',
    // MDX-Net（UVR model_data：compensate 1.009、dim_f 3072、dim_t 256、n_fft 7680），输入输出 float32 [batch, 4, 3072, 256]。
    files: [uvrMdxFile('Kim_Vocal_2.onnx', 66_759_214, 'ce74ef3b6a6024ce44211a07be9cf8bc6d87728cc852a68ab34eb8e58cde9c8b')],
  },
  {
    id: 'audio_dereverb_foxjoy',
    title: { zh: '去混响 Reverb HQ', en: 'Dereverb (Reverb HQ by FoxJoy)' },
    purpose: { zh: '去掉录音里的房间混响，让口播声音更干、更近', en: 'Removes room reverb from recordings so speech sounds drier and closer' },
    folderName: { zh: '去混响 Reverb HQ', en: 'Dereverb Reverb HQ' },
    homepage: 'https://github.com/Anjok07/ultimatevocalremovergui',
    license: UVR_MODEL_LICENSE,
    availability: 'available',
    // MDX-Net（UVR model_data：compensate 1.035、dim_f 3072、dim_t 512、n_fft 6144），模型预测的是混响分量。
    files: [uvrMdxFile('Reverb_HQ_By_FoxJoy.onnx', 66_780_123, '233bb5c6aaa365e568659a0a81211746fa881f8f47f82d9e864fce1f7692db80')],
  },
]

export function findLocalModelSpec(id: LocalModelId): LocalModelSpec {
  const spec = LOCAL_MODEL_MANIFEST.find((item) => item.id === id)
  if (!spec) throw new Error(`本地模型清单里没有 ${id}`)
  return spec
}

export function localModelSizeBytes(spec: LocalModelSpec): number {
  return spec.files.reduce((sum, file) => sum + file.sizeBytes, 0)
}
