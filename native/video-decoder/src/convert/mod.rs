//! 像素格式 → 共享输出格式与显卡写入路径，以及色彩换算参数（纯逻辑、跨平台，可单元测试）。
//! 各写入路径在显卡上的具体实现属于平台层（Windows：`platform/windows/convert.rs` + HLSL）。
//!
//! 输出格式只由像素布局决定（重要记录 007）：8 位、4:2:0、YUV、无透明 → `nv12`，其余 → `rgbaf16`。
//! 写入路径（1.3 设计第 3 条）：
//! - `CopyNv12`：硬解 NV12 表面切片直接复制到共享 nv12；
//! - `ShaderSemiPlanar`：硬解 NV12/P010 表面复制到中间纹理，计算着色器转 rgbaf16；
//! - `UploadNv12`：软解 8 位 4:2:0 平面数据在 CPU 交错为 NV12，经 STAGING 上传；
//! - `ShaderPlanar`：软解平面/半平面/打包数据整块写入 ByteAddressBuffer，通用计算着色器转 rgbaf16；
//! - `CpuFallback`：着色器读不了的罕见格式（大端、位流、调色板、浮点）先在 CPU 用 swscale 转 16 位平面，
//!   再走 `ShaderPlanar`，记警告日志（主控决定 3：主流格式不得依赖）。

use std::ffi::c_int;

use ffmpeg_sys_next as ff;
use serde_json::{json, Value};

use crate::test_pattern::SharedFormat;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WritePath {
    CopyNv12,
    ShaderSemiPlanar,
    UploadNv12,
    ShaderPlanar,
    CpuFallback,
}

impl WritePath {
    pub fn name(self) -> &'static str {
        match self {
            Self::CopyNv12 => "copy_nv12",
            Self::ShaderSemiPlanar => "shader_semiplanar",
            Self::UploadNv12 => "upload_nv12",
            Self::ShaderPlanar => "shader_planar",
            Self::CpuFallback => "cpu_fallback",
        }
    }
}

/// 一个像素格式的布局要点（来自 `AVPixFmtDescriptor`）。
#[derive(Debug, Clone, PartialEq)]
pub struct FormatInfo {
    pub name: String,
    pub depth: u32,
    pub log2_chroma_w: u32,
    pub log2_chroma_h: u32,
    pub components: u32,
    pub is_rgb: bool,
    pub has_alpha: bool,
    pub flags: u64,
}

pub fn pixel_format(value: c_int) -> Option<ff::AVPixelFormat> {
    if value < 0 || value >= ff::AVPixelFormat::AV_PIX_FMT_NB as c_int {
        return None;
    }
    // SAFETY: 取值已限定在 [0, AV_PIX_FMT_NB)，枚举值连续。
    Some(unsafe { std::mem::transmute::<c_int, ff::AVPixelFormat>(value) })
}

pub fn format_info(format: ff::AVPixelFormat) -> Option<FormatInfo> {
    let descriptor = unsafe { ff::av_pix_fmt_desc_get(format) };
    if descriptor.is_null() {
        return None;
    }
    let descriptor = unsafe { &*descriptor };
    Some(FormatInfo {
        name: crate::ffmpeg_info::c_text(descriptor.name).unwrap_or_default(),
        depth: descriptor.comp[0].depth as u32,
        log2_chroma_w: descriptor.log2_chroma_w as u32,
        log2_chroma_h: descriptor.log2_chroma_h as u32,
        components: descriptor.nb_components as u32,
        // 调色板格式的色板是 RGB：按 RGB 处理（CPU 回落转为平面 RGB，不引入矩阵换算）。
        is_rgb: descriptor.flags & (ff::AV_PIX_FMT_FLAG_RGB | ff::AV_PIX_FMT_FLAG_PAL) as u64 != 0,
        has_alpha: descriptor.flags & ff::AV_PIX_FMT_FLAG_ALPHA as u64 != 0,
        flags: descriptor.flags,
    })
}

/// 共享输出格式：8 位 4:2:0 YUV 无透明走 nv12，其余 rgbaf16。
pub fn output_format(info: &FormatInfo) -> SharedFormat {
    if info.depth == 8 && !info.is_rgb && !info.has_alpha && info.components >= 3 && info.log2_chroma_w == 1 && info.log2_chroma_h == 1 {
        SharedFormat::Nv12
    } else {
        SharedFormat::Rgbaf16
    }
}

/// 通用着色器能否直接读取（小端、非位流、非调色板、非浮点、非硬件、每样本 ≤16 位且 2 字节样本偶数对齐）。
pub fn planar_shader_supports(format: ff::AVPixelFormat) -> bool {
    let descriptor = unsafe { ff::av_pix_fmt_desc_get(format) };
    if descriptor.is_null() {
        return false;
    }
    let descriptor = unsafe { &*descriptor };
    let blocked = (ff::AV_PIX_FMT_FLAG_BE | ff::AV_PIX_FMT_FLAG_BITSTREAM | ff::AV_PIX_FMT_FLAG_PAL | ff::AV_PIX_FMT_FLAG_HWACCEL | ff::AV_PIX_FMT_FLAG_FLOAT | ff::AV_PIX_FMT_FLAG_BAYER | ff::AV_PIX_FMT_FLAG_XYZ) as u64;
    if descriptor.flags & blocked != 0 || descriptor.nb_components == 0 {
        return false;
    }
    descriptor.comp[..descriptor.nb_components as usize].iter().all(|comp| {
        let bits = comp.depth + comp.shift;
        let sample_bytes = if bits > 8 { 2 } else { 1 };
        bits <= 16 && comp.depth > 0 && (sample_bytes == 1 || (comp.step % 2 == 0 && comp.offset % 2 == 0))
    })
}

/// 选择写入路径。`hardware_sw_format` 为硬件帧的软件格式（软解帧为 None）。
pub fn write_path(output: SharedFormat, frame_format: ff::AVPixelFormat, hardware_sw_format: Option<ff::AVPixelFormat>) -> Result<WritePath, String> {
    use ff::AVPixelFormat::*;
    if let Some(sw) = hardware_sw_format {
        return match (output, sw) {
            (SharedFormat::Nv12, AV_PIX_FMT_NV12) => Ok(WritePath::CopyNv12),
            (SharedFormat::Rgbaf16, AV_PIX_FMT_NV12 | AV_PIX_FMT_P010LE) => Ok(WritePath::ShaderSemiPlanar),
            _ => Err(format!("硬解输出格式 {sw:?} 不能写成 {}", output.name())),
        };
    }
    match output {
        SharedFormat::Nv12 => match frame_format {
            AV_PIX_FMT_YUV420P | AV_PIX_FMT_YUVJ420P | AV_PIX_FMT_NV12 => Ok(WritePath::UploadNv12),
            other => Err(format!("像素格式 {other:?} 不能写成 nv12")),
        },
        SharedFormat::Rgbaf16 => Ok(if planar_shader_supports(frame_format) { WritePath::ShaderPlanar } else { WritePath::CpuFallback }),
        other => Err(format!("不支持输出 {}", other.name())),
    }
}

/// CPU 回落的目标格式（16 位平面，保留透明；RGB 源保持 RGB，不引入矩阵换算）。
pub fn fallback_format(is_rgb: bool, has_alpha: bool) -> ff::AVPixelFormat {
    use ff::AVPixelFormat::*;
    match (is_rgb, has_alpha) {
        (true, true) => AV_PIX_FMT_GBRAP16LE,
        (true, false) => AV_PIX_FMT_GBRP16LE,
        (false, true) => AV_PIX_FMT_YUVA444P16LE,
        (false, false) => AV_PIX_FMT_YUV444P16LE,
    }
}

/// 帧的色彩信息（未标注项已按 WebCodecs 路径的默认补齐）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ColorInfo {
    pub matrix: ff::AVColorSpace,
    pub primaries: ff::AVColorPrimaries,
    pub transfer: ff::AVColorTransferCharacteristic,
    pub full_range: bool,
    pub chroma_location: ff::AVChromaLocation,
    /// 原始传输特性是 PQ/HLG（按记录 008 当作 SDR）。
    pub hdr: bool,
}

impl ColorInfo {
    /// 从帧/流的色彩字段补齐默认值（与浏览器路径 `completeColorSpace` 一致：bt709、有限范围）。
    pub fn resolve(matrix: ff::AVColorSpace, primaries: ff::AVColorPrimaries, transfer: ff::AVColorTransferCharacteristic, range: ff::AVColorRange, chroma_location: ff::AVChromaLocation, pixel_format: ff::AVPixelFormat) -> Self {
        use ff::AVColorPrimaries::*;
        use ff::AVColorSpace::*;
        use ff::AVColorTransferCharacteristic::*;
        let jpeg = matches!(pixel_format, ff::AVPixelFormat::AV_PIX_FMT_YUVJ420P | ff::AVPixelFormat::AV_PIX_FMT_YUVJ422P | ff::AVPixelFormat::AV_PIX_FMT_YUVJ444P | ff::AVPixelFormat::AV_PIX_FMT_YUVJ440P | ff::AVPixelFormat::AV_PIX_FMT_YUVJ411P);
        let hdr = matches!(transfer, AVCOL_TRC_SMPTE2084 | AVCOL_TRC_ARIB_STD_B67);
        Self {
            matrix: if matrix == AVCOL_SPC_UNSPECIFIED || matrix == AVCOL_SPC_RESERVED { AVCOL_SPC_BT709 } else { matrix },
            primaries: if primaries == AVCOL_PRI_UNSPECIFIED || primaries == AVCOL_PRI_RESERVED || primaries == AVCOL_PRI_RESERVED0 { AVCOL_PRI_BT709 } else { primaries },
            transfer: if hdr || transfer == AVCOL_TRC_UNSPECIFIED || transfer == AVCOL_TRC_RESERVED || transfer == AVCOL_TRC_RESERVED0 { AVCOL_TRC_BT709 } else { transfer },
            full_range: range == ff::AVColorRange::AVCOL_RANGE_JPEG || (range == ff::AVColorRange::AVCOL_RANGE_UNSPECIFIED && jpeg),
            chroma_location,
            hdr,
        }
    }

    /// YUV→RGB 系数 (Kr, Kb)。
    pub fn coefficients(&self) -> (f32, f32) {
        use ff::AVColorSpace::*;
        match self.matrix {
            AVCOL_SPC_BT470BG | AVCOL_SPC_SMPTE170M => (0.299, 0.114),
            AVCOL_SPC_BT2020_NCL | AVCOL_SPC_BT2020_CL => (0.2627, 0.0593),
            AVCOL_SPC_SMPTE240M => (0.212, 0.087),
            AVCOL_SPC_FCC => (0.30, 0.11),
            _ => (0.2126, 0.0722),
        }
    }

    /// Electron `ColorSpace` 的矩阵名（nv12 用；rgbaf16 为 rgb）。
    pub fn electron_matrix(&self) -> &'static str {
        use ff::AVColorSpace::*;
        match self.matrix {
            AVCOL_SPC_BT470BG => "bt470bg",
            AVCOL_SPC_SMPTE170M => "smpte170m",
            AVCOL_SPC_BT2020_NCL | AVCOL_SPC_BT2020_CL => "bt2020-ncl",
            AVCOL_SPC_SMPTE240M => "smpte240m",
            AVCOL_SPC_FCC => "fcc",
            AVCOL_SPC_RGB => "rgb",
            _ => "bt709",
        }
    }

    pub fn electron_primaries(&self) -> &'static str {
        use ff::AVColorPrimaries::*;
        match self.primaries {
            AVCOL_PRI_BT470M => "bt470m",
            AVCOL_PRI_BT470BG => "bt470bg",
            AVCOL_PRI_SMPTE170M => "smpte170m",
            AVCOL_PRI_SMPTE240M => "smpte240m",
            AVCOL_PRI_FILM => "film",
            AVCOL_PRI_BT2020 => "bt2020",
            AVCOL_PRI_SMPTE428 => "smptest428-1",
            AVCOL_PRI_SMPTE431 => "smptest431-2",
            AVCOL_PRI_SMPTE432 => "p3",
            AVCOL_PRI_EBU3213 => "ebu-3213-e",
            _ => "bt709",
        }
    }

    pub fn electron_transfer(&self) -> &'static str {
        use ff::AVColorTransferCharacteristic::*;
        match self.transfer {
            AVCOL_TRC_GAMMA22 => "gamma22",
            AVCOL_TRC_GAMMA28 => "gamma28",
            AVCOL_TRC_SMPTE170M => "smpte170m",
            AVCOL_TRC_SMPTE240M => "smpte240m",
            AVCOL_TRC_LINEAR => "linear",
            AVCOL_TRC_LOG => "log",
            AVCOL_TRC_LOG_SQRT => "log-sqrt",
            AVCOL_TRC_IEC61966_2_4 => "iec61966-2-4",
            AVCOL_TRC_BT1361_ECG => "bt1361-ecg",
            AVCOL_TRC_IEC61966_2_1 => "srgb",
            AVCOL_TRC_BT2020_10 => "bt2020-10",
            AVCOL_TRC_BT2020_12 => "bt2020-12",
            AVCOL_TRC_SMPTE428 => "smptest428-1",
            _ => "bt709",
        }
    }

    /// 交给 Electron 的色彩空间。`transfer_override` 用于实验与记录 007 定下的 rgbaf16 标注规则。
    pub fn electron_color_space(&self, output: SharedFormat, transfer_override: Option<&str>) -> Value {
        let transfer = transfer_override.unwrap_or(self.electron_transfer());
        if output.is_yuv() {
            json!({ "primaries": self.electron_primaries(), "transfer": transfer, "matrix": self.electron_matrix(), "range": if self.full_range { "full" } else { "limited" } })
        } else {
            json!({ "primaries": self.electron_primaries(), "transfer": transfer, "matrix": "rgb", "range": "full" })
        }
    }

    /// 色度采样位置（以亮度像素为单位的原点偏移，横、纵）。缺省按左侧共址（MPEG-2/H.264 默认）。
    pub fn chroma_origin(&self, log2_w: u32, log2_h: u32) -> (f32, f32) {
        use ff::AVChromaLocation::*;
        let sx = (1u32 << log2_w) as f32;
        let sy = (1u32 << log2_h) as f32;
        let cosited = 0.5;
        let (horizontal_center, vertical) = match self.chroma_location {
            AVCHROMA_LOC_CENTER => (true, sy / 2.0),
            AVCHROMA_LOC_TOPLEFT => (false, cosited),
            AVCHROMA_LOC_TOP => (true, cosited),
            AVCHROMA_LOC_BOTTOMLEFT => (false, sy - 0.5),
            AVCHROMA_LOC_BOTTOM => (true, sy - 0.5),
            _ => (false, sy / 2.0),
        };
        let horizontal = if horizontal_center { sx / 2.0 } else { cosited };
        // 不下采样的方向：样本与亮度对齐。
        (if log2_w == 0 { 0.5 } else { horizontal }, if log2_h == 0 { 0.5 } else { vertical })
    }

    pub fn describe(&self) -> Value {
        json!({ "matrix": self.electron_matrix(), "primaries": self.electron_primaries(), "transfer": self.electron_transfer(), "range": if self.full_range { "full" } else { "limited" }, "hdrAsSdr": self.hdr })
    }
}

/// 位深 `depth` 的码值换算到 [0,1]（亮度）与 [-0.5,0.5]（色度）的偏移与跨度。
pub fn range_parameters(depth: u32, full_range: bool, is_rgb: bool) -> ([f32; 2], [f32; 2]) {
    let max = ((1u64 << depth) - 1) as f32;
    if is_rgb || full_range {
        let chroma_offset = (1u64 << (depth - 1)) as f32;
        return ([0.0, max], [chroma_offset, max]);
    }
    let scale = (1u64 << (depth - 8)) as f32;
    ([16.0 * scale, 219.0 * scale], [128.0 * scale, 224.0 * scale])
}

#[cfg(test)]
mod tests {
    use super::*;
    use ff::AVPixelFormat::*;

    fn info(format: ff::AVPixelFormat) -> FormatInfo {
        format_info(format).unwrap()
    }

    #[test]
    fn output_formats_follow_record_007() {
        for format in [AV_PIX_FMT_YUV420P, AV_PIX_FMT_YUVJ420P, AV_PIX_FMT_NV12] {
            assert_eq!(output_format(&info(format)), SharedFormat::Nv12, "{format:?}");
        }
        for format in [AV_PIX_FMT_YUV420P10LE, AV_PIX_FMT_P010LE, AV_PIX_FMT_YUV422P, AV_PIX_FMT_YUV422P10LE, AV_PIX_FMT_YUVA444P12LE, AV_PIX_FMT_YUVA420P, AV_PIX_FMT_GBRP12LE, AV_PIX_FMT_GBRAP12LE, AV_PIX_FMT_YUV444P, AV_PIX_FMT_GRAY8, AV_PIX_FMT_RGB24] {
            assert_eq!(output_format(&info(format)), SharedFormat::Rgbaf16, "{format:?}");
        }
    }

    #[test]
    fn write_paths() {
        use SharedFormat::*;
        assert_eq!(write_path(Nv12, AV_PIX_FMT_D3D11, Some(AV_PIX_FMT_NV12)), Ok(WritePath::CopyNv12));
        assert_eq!(write_path(Rgbaf16, AV_PIX_FMT_D3D11, Some(AV_PIX_FMT_P010LE)), Ok(WritePath::ShaderSemiPlanar));
        assert_eq!(write_path(Rgbaf16, AV_PIX_FMT_D3D11, Some(AV_PIX_FMT_NV12)), Ok(WritePath::ShaderSemiPlanar));
        assert!(write_path(Nv12, AV_PIX_FMT_D3D11, Some(AV_PIX_FMT_P010LE)).is_err());
        assert_eq!(write_path(Nv12, AV_PIX_FMT_YUV420P, None), Ok(WritePath::UploadNv12));
        assert!(write_path(Nv12, AV_PIX_FMT_YUV422P, None).is_err());
        // 主流软解格式全部走显卡着色器（不得依赖 CPU 回落）。
        for format in [AV_PIX_FMT_YUV422P10LE, AV_PIX_FMT_YUVA444P12LE, AV_PIX_FMT_YUV444P12LE, AV_PIX_FMT_YUV420P10LE, AV_PIX_FMT_YUV422P, AV_PIX_FMT_GBRP12LE, AV_PIX_FMT_GBRAP12LE, AV_PIX_FMT_YUVA420P, AV_PIX_FMT_YUV420P, AV_PIX_FMT_P010LE, AV_PIX_FMT_YUYV422, AV_PIX_FMT_UYVY422, AV_PIX_FMT_GRAY10LE] {
            assert_eq!(write_path(Rgbaf16, format, None), Ok(WritePath::ShaderPlanar), "{format:?}");
        }
        for format in [AV_PIX_FMT_YUV422P10BE, AV_PIX_FMT_PAL8, AV_PIX_FMT_MONOBLACK, AV_PIX_FMT_GBRPF32LE] {
            assert_eq!(write_path(Rgbaf16, format, None), Ok(WritePath::CpuFallback), "{format:?}");
        }
        let palette = info(AV_PIX_FMT_PAL8);
        assert!(palette.is_rgb, "调色板按 RGB 回落");
        assert_eq!(fallback_format(palette.is_rgb, palette.has_alpha), AV_PIX_FMT_GBRAP16LE);
    }

    #[test]
    fn colors_default_like_webcodecs() {
        use ff::AVChromaLocation::*;
        use ff::AVColorPrimaries::*;
        use ff::AVColorRange::*;
        use ff::AVColorSpace::*;
        use ff::AVColorTransferCharacteristic::*;
        let unspecified = ColorInfo::resolve(AVCOL_SPC_UNSPECIFIED, AVCOL_PRI_UNSPECIFIED, AVCOL_TRC_UNSPECIFIED, AVCOL_RANGE_UNSPECIFIED, AVCHROMA_LOC_UNSPECIFIED, AV_PIX_FMT_YUV420P);
        assert_eq!(unspecified.electron_color_space(SharedFormat::Nv12, None), json!({ "primaries": "bt709", "transfer": "bt709", "matrix": "bt709", "range": "limited" }));
        // Tripo NVENC：pc 范围 + bt470bg，传输/原色未标。
        let nvenc = ColorInfo::resolve(AVCOL_SPC_BT470BG, AVCOL_PRI_UNSPECIFIED, AVCOL_TRC_UNSPECIFIED, AVCOL_RANGE_JPEG, AVCHROMA_LOC_LEFT, AV_PIX_FMT_YUVJ420P);
        assert_eq!(nvenc.electron_color_space(SharedFormat::Nv12, None), json!({ "primaries": "bt709", "transfer": "bt709", "matrix": "bt470bg", "range": "full" }));
        assert_eq!(nvenc.coefficients(), (0.299, 0.114));
        // HDR 按 SDR 解释。
        let pq = ColorInfo::resolve(AVCOL_SPC_BT2020_NCL, AVCOL_PRI_BT2020, AVCOL_TRC_SMPTE2084, AVCOL_RANGE_MPEG, AVCHROMA_LOC_TOPLEFT, AV_PIX_FMT_YUV420P10LE);
        assert!(pq.hdr);
        assert_eq!(pq.electron_color_space(SharedFormat::Rgbaf16, None), json!({ "primaries": "bt2020", "transfer": "bt709", "matrix": "rgb", "range": "full" }));
        let srgb = ColorInfo::resolve(AVCOL_SPC_BT709, AVCOL_PRI_BT709, AVCOL_TRC_IEC61966_2_1, AVCOL_RANGE_MPEG, AVCHROMA_LOC_UNSPECIFIED, AV_PIX_FMT_YUVA444P12LE);
        assert_eq!(srgb.electron_transfer(), "srgb");
    }

    #[test]
    fn chroma_origins() {
        let mut color = ColorInfo::resolve(ff::AVColorSpace::AVCOL_SPC_BT709, ff::AVColorPrimaries::AVCOL_PRI_BT709, ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709, ff::AVColorRange::AVCOL_RANGE_MPEG, ff::AVChromaLocation::AVCHROMA_LOC_UNSPECIFIED, AV_PIX_FMT_YUV420P);
        assert_eq!(color.chroma_origin(1, 1), (0.5, 1.0), "左侧共址、纵向居中");
        assert_eq!(color.chroma_origin(1, 0), (0.5, 0.5), "4:2:2");
        assert_eq!(color.chroma_origin(0, 0), (0.5, 0.5), "4:4:4");
        color.chroma_location = ff::AVChromaLocation::AVCHROMA_LOC_CENTER;
        assert_eq!(color.chroma_origin(1, 1), (1.0, 1.0));
        color.chroma_location = ff::AVChromaLocation::AVCHROMA_LOC_TOPLEFT;
        assert_eq!(color.chroma_origin(1, 1), (0.5, 0.5));
    }

    #[test]
    fn range_scales() {
        assert_eq!(range_parameters(8, false, false), ([16.0, 219.0], [128.0, 224.0]));
        assert_eq!(range_parameters(10, false, false), ([64.0, 876.0], [512.0, 896.0]));
        assert_eq!(range_parameters(12, true, false), ([0.0, 4095.0], [2048.0, 4095.0]));
        assert_eq!(range_parameters(8, false, true).0, [0.0, 255.0], "RGB 恒为全范围");
    }
}
