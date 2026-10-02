//! 合成测试画面（1.2 纹理通道验证用，不解码真实文件）。
//!
//! 画面由三块组成，渲染进程据此做像素校验：
//! - 上部 8 条竖向色条（100% 白 + 75% 黄青绿品红蓝 + 黑），校验颜色与 YUV 矩阵/范围；
//! - 中部水平灰阶渐变，校验位深是否保留（10 位/浮点格式应出现明显多于 256 级的不同值）；
//! - 下部 16 个帧号位块（白=1、黑=0）与一个半透明色块（只对带透明的 RGB 格式有意义）。
//!
//! 本模块只负责布局与 CPU 侧像素编码（与平台无关、可单元测试）；写入显卡纹理在 streams.rs。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// `sharedTexture.importSharedTexture` 接受的像素格式（不含与 rgba 等价的 bgra 以外的变体）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SharedFormat {
    Nv12,
    Nv16,
    P010le,
    Rgba,
    Bgra,
    Rgbaf16,
}

impl SharedFormat {
    pub fn name(self) -> &'static str {
        match self {
            Self::Nv12 => "nv12",
            Self::Nv16 => "nv16",
            Self::P010le => "p010le",
            Self::Rgba => "rgba",
            Self::Bgra => "bgra",
            Self::Rgbaf16 => "rgbaf16",
        }
    }

    pub fn is_yuv(self) -> bool {
        matches!(self, Self::Nv12 | Self::Nv16 | Self::P010le)
    }

    /// 色度在水平/垂直方向的下采样因子。
    pub fn chroma_subsampling(self) -> (u32, u32) {
        match self {
            Self::Nv12 | Self::P010le => (2, 2),
            Self::Nv16 => (2, 1),
            _ => (1, 1),
        }
    }

    /// 宽高必须满足的对齐（平面格式按色度下采样对齐）。
    pub fn alignment(self) -> u32 {
        if self.is_yuv() {
            2
        } else {
            1
        }
    }

    /// 传给 Electron 的色彩空间。测试画面的 RGB 值按 sRGB 编码；YUV 用 BT.709 矩阵与有限范围，
    /// 传输特性同为 sRGB，使校验只检验矩阵与范围换算本身。真实素材（1.3）按文件色彩信息填写。
    pub fn test_color_space(self) -> Value {
        if self.is_yuv() {
            json!({ "primaries": "bt709", "transfer": "srgb", "matrix": "bt709", "range": "limited" })
        } else {
            json!({ "primaries": "bt709", "transfer": "srgb", "matrix": "rgb", "range": "full" })
        }
    }
}

pub const BIT_COUNT: u32 = 16;

/// 色条：100% 白、75% 黄/青/绿/品红/红/蓝、黑（sRGB 编码值）。
pub const BARS: [[f32; 3]; 8] = [
    [1.0, 1.0, 1.0],
    [0.75, 0.75, 0.0],
    [0.0, 0.75, 0.75],
    [0.0, 0.75, 0.0],
    [0.75, 0.0, 0.75],
    [0.75, 0.0, 0.0],
    [0.0, 0.0, 0.75],
    [0.0, 0.0, 0.0],
];

/// 半透明色块（非预乘颜色 + alpha）。
pub const ALPHA_BLOCK: [f32; 4] = [0.75, 0.25, 0.5, 0.5];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PatternLayout {
    pub width: u32,
    pub height: u32,
    pub bars_bottom: u32,
    pub ramp_top: u32,
    pub ramp_bottom: u32,
    pub bits_top: u32,
    pub block: u32,
    pub alpha_x: u32,
}

fn even(value: f64) -> u32 {
    ((value / 2.0).floor() as u32) * 2
}

impl PatternLayout {
    pub fn new(width: u32, height: u32) -> Self {
        // 16 个位块间隔排列需要 33 个块宽，再留出透明块的位置。
        let block = even((width as f64 / 40.0).min(64.0)).max(2);
        Self {
            width,
            height,
            bars_bottom: even(height as f64 * 0.55),
            ramp_top: even(height as f64 * 0.55),
            ramp_bottom: even(height as f64 * 0.70),
            bits_top: even(height as f64 * 0.78),
            block,
            alpha_x: width - 4 * block,
        }
    }

    pub fn bit_x(&self, bit: u32) -> u32 {
        self.block * (1 + 2 * bit)
    }

    /// 模板画面（不含帧号位块）在 (x, y) 的 sRGB 颜色与 alpha。
    pub fn template_pixel(&self, x: u32, y: u32) -> [f32; 4] {
        if y < self.bars_bottom {
            let bar = BARS[((x as u64 * 8) / self.width as u64).min(7) as usize];
            return [bar[0], bar[1], bar[2], 1.0];
        }
        if y >= self.ramp_top && y < self.ramp_bottom {
            let v = x as f32 / (self.width.max(2) - 1) as f32;
            return [v, v, v, 1.0];
        }
        if y >= self.bits_top && y < self.bits_top + self.block && x >= self.alpha_x && x < self.alpha_x + self.block {
            return ALPHA_BLOCK;
        }
        [0.0, 0.0, 0.0, 1.0]
    }

    /// 返回给渲染进程的布局描述（唯一来源，渲染进程按它取样与比较）。
    pub fn describe(&self) -> Value {
        json!({
            "width": self.width,
            "height": self.height,
            "bars": BARS.iter().enumerate().map(|(index, color)| json!({
                "x": (self.width as u64 * (2 * index as u64 + 1) / 16) as u32,
                "y": self.bars_bottom / 2,
                "color": color,
            })).collect::<Vec<_>>(),
            "ramp": { "y": (self.ramp_top + self.ramp_bottom) / 2, "x0": 0, "x1": self.width - 1 },
            "bits": (0..BIT_COUNT).map(|bit| json!({ "x": self.bit_x(bit) + self.block / 2, "y": self.bits_top + self.block / 2 })).collect::<Vec<_>>(),
            "alpha": { "x": self.alpha_x + self.block / 2, "y": self.bits_top + self.block / 2, "color": ALPHA_BLOCK },
            "background": { "x": self.bit_x(0) + self.block / 2, "y": self.bits_top + self.block * 2 },
        })
    }
}

/// 一个平面的紧凑像素数据（行宽 `row_bytes`，共 `rows` 行）。写入显卡时按实际行距拷贝。
#[derive(Debug, Clone, PartialEq)]
pub struct Plane {
    pub bytes: Vec<u8>,
    pub row_bytes: usize,
    pub rows: usize,
}

/// BT.709 有限范围：返回 (Y, Cb, Cr) 归一化值，Y∈[0,1]，Cb/Cr∈[-0.5,0.5]。
pub fn bt709(rgb: [f32; 3]) -> (f32, f32, f32) {
    let y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    (y, (rgb[2] - y) / 1.8556, (rgb[0] - y) / 1.5748)
}

fn luma_code(y: f32, bits: u32) -> u16 {
    let scale = (1u32 << (bits - 8)) as f32;
    (16.0 * scale + 219.0 * scale * y).round().clamp(0.0, ((1u32 << bits) - 1) as f32) as u16
}

fn chroma_code(c: f32, bits: u32) -> u16 {
    let scale = (1u32 << (bits - 8)) as f32;
    (128.0 * scale + 224.0 * scale * c).round().clamp(0.0, ((1u32 << bits) - 1) as f32) as u16
}

/// f32 → IEEE 半精度（只处理本模块用到的 [0, 1] 有限值，四舍五入到最近）。
pub fn f16_bits(value: f32) -> u16 {
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32;
    let mantissa = bits & 0x7f_ffff;
    if exponent == 0 && mantissa == 0 {
        return sign;
    }
    let half_exponent = exponent - 127 + 15;
    if half_exponent >= 0x1f {
        return sign | 0x7c00;
    }
    if half_exponent <= 0 {
        // 非规格化：本画面不会出现极小值，按 0 处理。
        return sign;
    }
    let mut half = ((half_exponent as u32) << 10) | (mantissa >> 13);
    let round = mantissa & 0x1fff;
    if round > 0x1000 || (round == 0x1000 && (half & 1) == 1) {
        half += 1;
    }
    sign | half as u16
}

/// 按格式把 `pixel(x, y)` 编码为平面数据。宽高需满足格式对齐。
pub fn encode(format: SharedFormat, width: u32, height: u32, pixel: impl Fn(u32, u32) -> [f32; 4]) -> Vec<Plane> {
    let (w, h) = (width as usize, height as usize);
    match format {
        SharedFormat::Rgba | SharedFormat::Bgra => {
            let mut bytes = vec![0u8; w * h * 4];
            for y in 0..height {
                for x in 0..width {
                    let p = pixel(x, y);
                    let q = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                    let offset = (y as usize * w + x as usize) * 4;
                    let rgba = [q(p[0]), q(p[1]), q(p[2]), q(p[3])];
                    let ordered = if format == SharedFormat::Bgra { [rgba[2], rgba[1], rgba[0], rgba[3]] } else { rgba };
                    bytes[offset..offset + 4].copy_from_slice(&ordered);
                }
            }
            vec![Plane { bytes, row_bytes: w * 4, rows: h }]
        }
        SharedFormat::Rgbaf16 => {
            let mut bytes = vec![0u8; w * h * 8];
            for y in 0..height {
                for x in 0..width {
                    let p = pixel(x, y);
                    let offset = (y as usize * w + x as usize) * 8;
                    for channel in 0..4 {
                        bytes[offset + channel * 2..offset + channel * 2 + 2].copy_from_slice(&f16_bits(p[channel]).to_le_bytes());
                    }
                }
            }
            vec![Plane { bytes, row_bytes: w * 8, rows: h }]
        }
        SharedFormat::Nv12 | SharedFormat::Nv16 | SharedFormat::P010le => {
            let (bits, sample_bytes) = if format == SharedFormat::P010le { (10, 2) } else { (8, 1) };
            let (sx, sy) = format.chroma_subsampling();
            let write = |buffer: &mut Vec<u8>, offset: usize, code: u16| {
                if sample_bytes == 2 {
                    // P010：10 位有效值放在 16 位的高位。
                    buffer[offset..offset + 2].copy_from_slice(&(code << 6).to_le_bytes());
                } else {
                    buffer[offset] = code as u8;
                }
            };
            let mut luma = vec![0u8; w * h * sample_bytes];
            for y in 0..height {
                for x in 0..width {
                    let p = pixel(x, y);
                    write(&mut luma, (y as usize * w + x as usize) * sample_bytes, luma_code(bt709([p[0], p[1], p[2]]).0, bits));
                }
            }
            let chroma_rows = h / sy as usize;
            let chroma_cols = w / sx as usize;
            let mut chroma = vec![0u8; chroma_cols * 2 * sample_bytes * chroma_rows];
            for row in 0..chroma_rows {
                for col in 0..chroma_cols {
                    let p = pixel(col as u32 * sx, row as u32 * sy);
                    let (_, cb, cr) = bt709([p[0], p[1], p[2]]);
                    let offset = (row * chroma_cols + col) * 2 * sample_bytes;
                    write(&mut chroma, offset, chroma_code(cb, bits));
                    write(&mut chroma, offset + sample_bytes, chroma_code(cr, bits));
                }
            }
            vec![
                Plane { bytes: luma, row_bytes: w * sample_bytes, rows: h },
                Plane { bytes: chroma, row_bytes: chroma_cols * 2 * sample_bytes, rows: chroma_rows },
            ]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_fits_bits_and_alpha_block() {
        for (width, height) in [(3840, 2160), (2560, 2560), (1920, 1080)] {
            let layout = PatternLayout::new(width, height);
            assert_eq!(layout.block % 2, 0);
            assert!(layout.bit_x(BIT_COUNT - 1) + layout.block < layout.alpha_x, "{width}x{height} 位块与透明块重叠");
            assert!(layout.alpha_x + layout.block <= width);
            assert!(layout.bits_top + layout.block * 3 <= height);
            assert_eq!(layout.bits_top % 2, 0);
        }
    }

    #[test]
    fn template_regions() {
        let layout = PatternLayout::new(3840, 2160);
        assert_eq!(layout.template_pixel(10, 10), [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(layout.template_pixel(3839, 10), [0.0, 0.0, 0.0, 1.0]);
        assert_eq!(layout.template_pixel(3840 * 5 / 8 + 5, 100), [0.75, 0.0, 0.0, 1.0]);
        let ramp_y = layout.ramp_top + 1;
        assert_eq!(layout.template_pixel(0, ramp_y)[0], 0.0);
        assert_eq!(layout.template_pixel(3839, ramp_y)[0], 1.0);
        assert_eq!(layout.template_pixel(layout.alpha_x + 1, layout.bits_top + 1), ALPHA_BLOCK);
        let described = layout.describe();
        assert_eq!(described["bars"].as_array().unwrap().len(), 8);
        assert_eq!(described["bits"].as_array().unwrap().len(), BIT_COUNT as usize);
    }

    #[test]
    fn bt709_limited_codes() {
        let (y, cb, cr) = bt709([1.0, 1.0, 1.0]);
        assert_eq!((luma_code(y, 8), chroma_code(cb, 8), chroma_code(cr, 8)), (235, 128, 128));
        assert_eq!(luma_code(0.0, 10), 64);
        assert_eq!(luma_code(1.0, 10), 940);
        let (y, cb, cr) = bt709([0.75, 0.0, 0.0]);
        // 75% 红：BT.709 有限范围 8 位约为 (51, 109, 212)。
        assert_eq!((luma_code(y, 8), chroma_code(cb, 8), chroma_code(cr, 8)), (51, 109, 212));
    }

    #[test]
    fn half_float_conversion() {
        assert_eq!(f16_bits(0.0), 0);
        assert_eq!(f16_bits(1.0), 0x3c00);
        assert_eq!(f16_bits(0.5), 0x3800);
        assert_eq!(f16_bits(0.75), 0x3a00);
        // 1/3 最近的半精度值 0x3555。
        assert_eq!(f16_bits(1.0 / 3.0), 0x3555);
    }

    #[test]
    fn planar_encodings_have_expected_shapes() {
        let solid = |_: u32, _: u32| [1.0f32, 1.0, 1.0, 1.0];
        let nv12 = encode(SharedFormat::Nv12, 8, 4, solid);
        assert_eq!((nv12[0].bytes.len(), nv12[1].bytes.len(), nv12[1].rows), (32, 16, 2));
        assert!(nv12[0].bytes.iter().all(|value| *value == 235));
        let nv16 = encode(SharedFormat::Nv16, 8, 4, solid);
        assert_eq!((nv16[1].bytes.len(), nv16[1].rows), (32, 4));
        let p010 = encode(SharedFormat::P010le, 8, 4, solid);
        assert_eq!(p010[0].bytes.len(), 64);
        assert_eq!(u16::from_le_bytes([p010[0].bytes[0], p010[0].bytes[1]]), 940 << 6);
        let bgra = encode(SharedFormat::Bgra, 2, 2, |_, _| [1.0, 0.0, 0.5, 1.0]);
        assert_eq!(&bgra[0].bytes[0..4], &[128, 0, 255, 255]);
        let f16 = encode(SharedFormat::Rgbaf16, 1, 1, |_, _| [1.0, 0.5, 0.0, 0.5]);
        assert_eq!(f16[0].bytes, vec![0x00, 0x3c, 0x00, 0x38, 0x00, 0x00, 0x00, 0x38]);
    }
}
