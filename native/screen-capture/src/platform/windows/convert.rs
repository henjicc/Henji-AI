//! 在显卡上把采到的 BGRA 画面转成 BT.709 有限范围的 NV12（编码器的输入）。
//!
//! 用自己的着色器而不是系统的视频处理器：后者的输出受显卡驱动“视频”设置（降噪、锐化、色彩增强）影响，
//! 录屏要的是与屏幕一致、各机器相同的颜色。矩阵与范围在这里写死，编码器只管压缩。
//!
//! NV12 纹理的两个平面各建一个渲染目标视图（亮度 R8，色度 R8G8，半分辨率），两遍全屏三角形写入。
//! 色度按 H.264/HEVC 默认的“左对齐”取样：水平方向以偶数列为中心做 1-2-1 滤波，垂直方向取两行平均。

use super::device::Gpu;
use std::{collections::HashMap, ffi::c_void, sync::Mutex};
use windows::core::{Interface, PCSTR};
use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
use windows::Win32::Graphics::Direct3D::{ID3DBlob, D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_R8G8_UNORM, DXGI_FORMAT_R8_UNORM};

const SHADER: &str = r#"
Texture2D source : register(t0);
SamplerState linear_clamp : register(s0);

struct Pixel {
    float4 position : SV_Position;
    float2 uv : TEXCOORD0;
};

Pixel vs_main(uint id : SV_VertexID) {
    Pixel pixel;
    pixel.uv = float2((id << 1) & 2, id & 2);
    pixel.position = float4(pixel.uv * float2(2, -2) + float2(-1, 1), 0, 1);
    return pixel;
}

// BT.709，输入是屏幕上带伽马的 R'G'B'（0–1），输出有限范围：亮度 16–235，色度 16–240。
float ps_luma(Pixel pixel) : SV_Target {
    float3 rgb = source.Sample(linear_clamp, pixel.uv).rgb;
    return dot(rgb, float3(0.2126, 0.7152, 0.0722)) * (219.0 / 255.0) + 16.0 / 255.0;
}

float2 ps_chroma(Pixel pixel) : SV_Target {
    // 色度像素中心落在两列亮度之间；再往左半个色度像素取一次，两次平均后以偶数列为中心。
    float2 left = float2(ddx(pixel.uv.x) * 0.5, 0);
    float3 rgb = (source.Sample(linear_clamp, pixel.uv).rgb + source.Sample(linear_clamp, pixel.uv - left).rgb) * 0.5;
    float cb = dot(rgb, float3(-0.114572, -0.385428, 0.5));
    float cr = dot(rgb, float3(0.5, -0.454153, -0.045847));
    return float2(cb, cr) * (224.0 / 255.0) + 128.0 / 255.0;
}

// 预览：原样缩放，不转色彩。
float4 ps_copy(Pixel pixel) : SV_Target {
    return float4(source.Sample(linear_clamp, pixel.uv).rgb, 1);
}
"#;

struct Targets {
    luma: ID3D11RenderTargetView,
    chroma: ID3D11RenderTargetView,
}

pub struct Converter {
    vertex: ID3D11VertexShader,
    luma: ID3D11PixelShader,
    chroma: ID3D11PixelShader,
    copy: ID3D11PixelShader,
    sampler: ID3D11SamplerState,
    /// 输出纹理来自编码帧池，同一批纹理循环使用；视图按纹理地址缓存（视图持有纹理的引用，地址不会被别的纹理复用）。
    targets: Mutex<HashMap<usize, Targets>>,
}

unsafe impl Send for Converter {}
unsafe impl Sync for Converter {}

fn compile(entry: PCSTR, target: PCSTR) -> Result<ID3DBlob, String> {
    let mut code = None;
    let mut errors = None;
    let result = unsafe { D3DCompile(SHADER.as_ptr() as *const c_void, SHADER.len(), PCSTR::null(), None, None, entry, target, 0, 0, &mut code, Some(&mut errors)) };
    if let Err(error) = result {
        let detail = errors
            .map(|blob: ID3DBlob| unsafe { String::from_utf8_lossy(std::slice::from_raw_parts(blob.GetBufferPointer() as *const u8, blob.GetBufferSize())).into_owned() })
            .unwrap_or_default();
        return Err(format!("CAPTURE_FAILED|色彩转换着色器编译失败：{error} {detail}"));
    }
    code.ok_or_else(|| "CAPTURE_FAILED|色彩转换着色器编译没有输出".to_string())
}

fn bytes(blob: &ID3DBlob) -> &[u8] {
    unsafe { std::slice::from_raw_parts(blob.GetBufferPointer() as *const u8, blob.GetBufferSize()) }
}

impl Converter {
    pub fn new(gpu: &Gpu) -> Result<Self, String> {
        let failed = |error: windows::core::Error| format!("CAPTURE_FAILED|无法创建色彩转换资源：{error}");
        unsafe {
            let (mut vertex, mut luma, mut chroma, mut copy, mut sampler) = (None, None, None, None, None);
            gpu.device.CreateVertexShader(bytes(&compile(windows::core::s!("vs_main"), windows::core::s!("vs_5_0"))?), None, Some(&mut vertex)).map_err(failed)?;
            gpu.device.CreatePixelShader(bytes(&compile(windows::core::s!("ps_luma"), windows::core::s!("ps_5_0"))?), None, Some(&mut luma)).map_err(failed)?;
            gpu.device.CreatePixelShader(bytes(&compile(windows::core::s!("ps_chroma"), windows::core::s!("ps_5_0"))?), None, Some(&mut chroma)).map_err(failed)?;
            gpu.device.CreatePixelShader(bytes(&compile(windows::core::s!("ps_copy"), windows::core::s!("ps_5_0"))?), None, Some(&mut copy)).map_err(failed)?;
            let description = D3D11_SAMPLER_DESC {
                Filter: D3D11_FILTER_MIN_MAG_LINEAR_MIP_POINT,
                AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                MaxLOD: f32::MAX,
                ..Default::default()
            };
            gpu.device.CreateSamplerState(&description, Some(&mut sampler)).map_err(failed)?;
            Ok(Self { vertex: vertex.unwrap(), luma: luma.unwrap(), chroma: chroma.unwrap(), copy: copy.unwrap(), sampler: sampler.unwrap(), targets: Mutex::new(HashMap::new()) })
        }
    }

    fn plane(gpu: &Gpu, texture: &ID3D11Texture2D, format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT) -> windows::core::Result<ID3D11RenderTargetView> {
        let description = D3D11_RENDER_TARGET_VIEW_DESC {
            Format: format,
            ViewDimension: D3D11_RTV_DIMENSION_TEXTURE2D,
            Anonymous: D3D11_RENDER_TARGET_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_RTV { MipSlice: 0 } },
        };
        let mut view = None;
        unsafe { gpu.device.CreateRenderTargetView(texture, Some(&description), Some(&mut view))? };
        Ok(view.unwrap())
    }

    /// 等比缩放后居中的视口；divisor 是平面相对整幅的缩小倍数（色度平面为 2）。返回视口与“四周是否留黑”。
    fn fit(source: &ID3D11Texture2D, width: u32, height: u32, divisor: f32) -> (D3D11_VIEWPORT, bool) {
        let mut description = D3D11_TEXTURE2D_DESC::default();
        unsafe { source.GetDesc(&mut description) };
        let scale = (width as f32 / description.Width as f32).min(height as f32 / description.Height as f32);
        let (fit_width, fit_height) = ((description.Width as f32 * scale).round(), (description.Height as f32 * scale).round());
        let viewport = D3D11_VIEWPORT {
            TopLeftX: ((width as f32 - fit_width) / 2.0 / divisor).floor(),
            TopLeftY: ((height as f32 - fit_height) / 2.0 / divisor).floor(),
            Width: fit_width / divisor,
            Height: fit_height / divisor,
            MinDepth: 0.0,
            MaxDepth: 1.0,
        };
        (viewport, fit_width < width as f32 || fit_height < height as f32)
    }

    /// 以 source 为输入依次画几遍：每遍一个渲染目标、一个像素着色器、一个视口，需要时先清成给定的底色。
    fn render(&self, gpu: &Gpu, source: &ID3D11Texture2D, passes: &[(&ID3D11RenderTargetView, &ID3D11PixelShader, D3D11_VIEWPORT, Option<[f32; 4]>)]) -> windows::core::Result<()> {
        unsafe {
            let mut source_view = None;
            gpu.device.CreateShaderResourceView(source, None, Some(&mut source_view))?;
            // 立即上下文的状态是全设备共用的：整段在锁内一次设全，不依赖上一次留下的状态。
            let context = gpu.lock();
            context.IASetInputLayout(None);
            context.IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            context.VSSetShader(&self.vertex, None);
            context.RSSetState(None);
            context.OMSetBlendState(None, None, u32::MAX);
            context.OMSetDepthStencilState(None, 0);
            context.PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
            context.PSSetShaderResources(0, Some(&[source_view.clone()]));
            for (view, shader, viewport, clear) in passes {
                if let Some(color) = clear {
                    context.ClearRenderTargetView(*view, color);
                }
                context.OMSetRenderTargets(Some(&[Some((*view).clone())]), None);
                context.RSSetViewports(Some(&[*viewport]));
                context.PSSetShader(*shader, None);
                context.Draw(3, 0);
            }
            context.OMSetRenderTargets(None, None);
            context.PSSetShaderResources(0, Some(&[None]));
            // 交给显卡执行：采集帧随后归还给系统，拷贝要在它被下一帧覆盖之前排上。
            context.Flush();
            Ok(())
        }
    }

    /// 把 source 整幅画到 target（NV12，width × height）。尺寸不同时等比缩放、四周留黑。
    pub fn convert(&self, gpu: &Gpu, source: &ID3D11Texture2D, target: &ID3D11Texture2D, width: u32, height: u32) -> windows::core::Result<()> {
        let mut targets = self.targets.lock().unwrap();
        let key = target.as_raw() as usize;
        if !targets.contains_key(&key) {
            targets.insert(key, Targets { luma: Self::plane(gpu, target, DXGI_FORMAT_R8_UNORM)?, chroma: Self::plane(gpu, target, DXGI_FORMAT_R8G8_UNORM)? });
        }
        let views = &targets[&key];
        let (luma_viewport, letterboxed) = Self::fit(source, width, height, 1.0);
        let (chroma_viewport, _) = Self::fit(source, width, height, 2.0);
        let black = |level: f32| letterboxed.then_some([level, level, 0.0, 0.0]);
        self.render(gpu, source, &[(&views.luma, &self.luma, luma_viewport, black(16.0 / 255.0)), (&views.chroma, &self.chroma, chroma_viewport, black(128.0 / 255.0))])
    }

    /// 把 source 等比缩放画到一张 BGRA 渲染目标上（预览用）。
    pub fn copy(&self, gpu: &Gpu, source: &ID3D11Texture2D, target: &ID3D11RenderTargetView, width: u32, height: u32) -> windows::core::Result<()> {
        let (viewport, letterboxed) = Self::fit(source, width, height, 1.0);
        self.render(gpu, source, &[(target, &self.copy, viewport, letterboxed.then_some([0.0, 0.0, 0.0, 1.0]))])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT, DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_NV12, DXGI_SAMPLE_DESC};

    fn texture(gpu: &Gpu, format: DXGI_FORMAT, usage: D3D11_USAGE, bind: u32, cpu: u32, pixels: Option<&[u8]>) -> ID3D11Texture2D {
        let description = D3D11_TEXTURE2D_DESC {
            Width: 64,
            Height: 64,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: usage,
            BindFlags: bind,
            CPUAccessFlags: cpu,
            MiscFlags: 0,
        };
        let initial = pixels.map(|pixels| D3D11_SUBRESOURCE_DATA { pSysMem: pixels.as_ptr() as *const c_void, SysMemPitch: 64 * 4, SysMemSlicePitch: 0 });
        let mut created = None;
        unsafe { gpu.device.CreateTexture2D(&description, initial.as_ref().map(|data| data as *const _), Some(&mut created)).unwrap() };
        created.unwrap()
    }

    /// 来源换了分辨率（这里是 64×64 的输出收到 64×32 的来源）：画面等比居中，上下留黑（Y=16、色度 128）。没有 NVIDIA 显卡时跳过。
    #[test]
    fn a_source_with_another_aspect_is_letterboxed() {
        let Ok(gpu) = Gpu::create_for_nvenc() else { return };
        let converter = Converter::new(&gpu).unwrap();
        let pixels: Vec<u8> = (0..64 * 32).flat_map(|_| [255u8, 255, 255, 255]).collect();
        let description = D3D11_TEXTURE2D_DESC {
            Width: 64,
            Height: 32,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let initial = D3D11_SUBRESOURCE_DATA { pSysMem: pixels.as_ptr() as *const c_void, SysMemPitch: 64 * 4, SysMemSlicePitch: 0 };
        let mut source = None;
        unsafe { gpu.device.CreateTexture2D(&description, Some(&initial), Some(&mut source)).unwrap() };
        let target = texture(&gpu, DXGI_FORMAT_NV12, D3D11_USAGE_DEFAULT, D3D11_BIND_RENDER_TARGET.0 as u32, 0, None);
        let staging = texture(&gpu, DXGI_FORMAT_NV12, D3D11_USAGE_STAGING, 0, D3D11_CPU_ACCESS_READ.0 as u32, None);
        converter.convert(&gpu, &source.unwrap(), &target, 64, 64).unwrap();
        let context = gpu.lock();
        unsafe {
            context.CopyResource(&staging, &target);
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).unwrap();
            let pitch = mapped.RowPitch as usize;
            let data = std::slice::from_raw_parts(mapped.pData as *const u8, pitch * 96);
            let luma = |row: usize| data[row * pitch + 32] as i32;
            let (top, middle, bottom, top_chroma) = (luma(4), luma(32), luma(60), data[64 * pitch + 2 * pitch + 32] as i32);
            context.Unmap(&staging, 0);
            assert!((top - 16).abs() <= 1 && (bottom - 16).abs() <= 1 && (middle - 235).abs() <= 1 && (top_chroma - 128).abs() <= 1, "上 {top} 中 {middle} 下 {bottom} 色度 {top_chroma}");
        }
    }

    /// 在真实显卡上把纯色画面转成 NV12 再读回，核对 BT.709 有限范围的数值（误差一级以内）。没有 NVIDIA 显卡时跳过。
    #[test]
    fn solid_colors_convert_to_bt709_limited_range() {
        let gpu = match Gpu::create_for_nvenc() {
            Ok(gpu) => gpu,
            Err(error) => {
                eprintln!("跳过：{error}");
                return;
            }
        };
        let converter = Converter::new(&gpu).unwrap();
        // (R, G, B) → (Y, Cb, Cr)
        let cases: [([u8; 3], [i32; 3]); 7] = [
            ([255, 255, 255], [235, 128, 128]),
            ([0, 0, 0], [16, 128, 128]),
            ([255, 0, 0], [63, 102, 240]),
            ([0, 255, 0], [173, 42, 26]),
            ([0, 0, 255], [32, 240, 118]),
            ([128, 128, 128], [126, 128, 128]),
            ([64, 160, 224], [140, 166, 83]),
        ];
        for ([red, green, blue], expected) in cases {
            let pixels: Vec<u8> = (0..64 * 64).flat_map(|_| [blue, green, red, 255]).collect();
            let source = texture(&gpu, DXGI_FORMAT_B8G8R8A8_UNORM, D3D11_USAGE_DEFAULT, D3D11_BIND_SHADER_RESOURCE.0 as u32, 0, Some(&pixels));
            let target = texture(&gpu, DXGI_FORMAT_NV12, D3D11_USAGE_DEFAULT, D3D11_BIND_RENDER_TARGET.0 as u32, 0, None);
            let staging = texture(&gpu, DXGI_FORMAT_NV12, D3D11_USAGE_STAGING, 0, D3D11_CPU_ACCESS_READ.0 as u32, None);
            converter.convert(&gpu, &source, &target, 64, 64).unwrap();
            let context = gpu.lock();
            unsafe {
                context.CopyResource(&staging, &target);
                let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).unwrap();
                let pitch = mapped.RowPitch as usize;
                // NV12 在内存里是 64 行亮度后接 32 行交错的色度。
                let data = std::slice::from_raw_parts(mapped.pData as *const u8, pitch * 96);
                let chroma = 64 * pitch + 16 * pitch + 32;
                let actual = [data[32 * pitch + 32] as i32, data[chroma] as i32, data[chroma + 1] as i32];
                context.Unmap(&staging, 0);
                for plane in 0..3 {
                    assert!((actual[plane] - expected[plane]).abs() <= 1, "RGB({red},{green},{blue}) 得到 YCbCr{actual:?}，应为 {expected:?}");
                }
            }
        }
    }
}
