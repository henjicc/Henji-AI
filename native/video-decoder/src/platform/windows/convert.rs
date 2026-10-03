//! （Windows 平台层）把一帧解码画面写入共享纹理池槽位（显卡上完成格式转换，见 `convert/mod.rs` 的写入路径）。
//!
//! 锁的使用：大块内存复制不持上下文锁——持锁 `Map` → 释放锁复制 → 等槽位的键控互斥体 → 持锁 `Unmap`、
//! 调度与复制到槽位 → 释放互斥体并 Flush。D3D11 允许映射期间其他线程继续使用立即上下文。

use std::ffi::c_int;
use std::sync::{Arc, OnceLock};
use std::time::Instant;

use ffmpeg_sys_next as ff;
use windows::core::{Interface, PCSTR};
use windows::Win32::Foundation::WAIT_TIMEOUT;
use windows::Win32::Graphics::Direct3D::Fxc::{D3DCompile, D3DCOMPILE_ENABLE_STRICTNESS, D3DCOMPILE_OPTIMIZATION_LEVEL3};
use windows::Win32::Graphics::Direct3D::{ID3DBlob, D3D11_SRV_DIMENSION_BUFFEREX, D3D11_SRV_DIMENSION_TEXTURE2D};
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;
use windows::Win32::Graphics::Dxgi::DXGI_ERROR_WAS_STILL_DRAWING;

use super::device::GpuDevice;
use super::shared_texture::SharedSlot;
use crate::convert::{fallback_format, format_info, range_parameters, ColorInfo, WritePath};
use crate::platform::WriteStats;

const SOURCE: &str = include_str!("convert.hlsl");
const KEYED_MUTEX_TIMEOUT_MS: u32 = 500;
/// 大于该字节数的平面复制分给多个线程。
const PARALLEL_COPY_BYTES: usize = 4 * 1024 * 1024;
const COPY_THREADS: usize = 4;

/// 上传复制的常驻线程池（进程内一个，`COPY_THREADS` 个长期线程）。3.2 实测：每帧用 `std::thread::scope` 新建 4 个线程时，
/// 软解（ProRes、DNxHR）每解约 1000 帧关闭后私有提交残留约 0.8MB 且不封顶（Windows 上每个新线程都让已加载的 DLL 收到线程
/// 挂接）；改为常驻线程后不再随帧数增长。线程池建不起来时退回当前线程顺序复制（只影响速度）。
fn copy_pool() -> Option<&'static rayon::ThreadPool> {
    static POOL: OnceLock<Option<rayon::ThreadPool>> = OnceLock::new();
    POOL.get_or_init(|| rayon::ThreadPoolBuilder::new().num_threads(COPY_THREADS).thread_name(|index| format!("upload-copy-{index}")).build().ok()).as_ref()
}

/// 在常驻线程池上并行执行一组复制任务并等全部完成；没有线程池时顺序执行。
fn run_copies<F: FnOnce() + Send>(jobs: Vec<F>) {
    match copy_pool() {
        Some(pool) => pool.scope(|scope| {
            for job in jobs {
                scope.spawn(move |_| job());
            }
        }),
        None => jobs.into_iter().for_each(|job| job()),
    }
}

/// 编译好的着色器字节码（与设备无关，进程内缓存）。
pub struct Bytecode {
    pub planar: Vec<u8>,
    pub semiplanar: Vec<u8>,
    pub compile_ms: f64,
}

static BYTECODE: OnceLock<Result<Bytecode, String>> = OnceLock::new();

fn blob_bytes(blob: &ID3DBlob) -> Vec<u8> {
    unsafe { std::slice::from_raw_parts(blob.GetBufferPointer() as *const u8, blob.GetBufferSize()).to_vec() }
}

fn compile(entry: &std::ffi::CStr) -> Result<Vec<u8>, String> {
    let mut code: Option<ID3DBlob> = None;
    let mut errors: Option<ID3DBlob> = None;
    let result = unsafe {
        D3DCompile(
            SOURCE.as_ptr() as *const _,
            SOURCE.len(),
            PCSTR(c"convert.hlsl".as_ptr() as *const u8),
            None,
            None,
            PCSTR(entry.as_ptr() as *const u8),
            PCSTR(c"cs_5_0".as_ptr() as *const u8),
            D3DCOMPILE_OPTIMIZATION_LEVEL3 | D3DCOMPILE_ENABLE_STRICTNESS,
            0,
            &mut code,
            Some(&mut errors),
        )
    };
    let message = errors.as_ref().map(|blob| String::from_utf8_lossy(&blob_bytes(blob)).trim().to_string()).unwrap_or_default();
    result.map_err(|error| format!("编译着色器 {entry:?} 失败：{error} {message}"))?;
    code.map(|blob| blob_bytes(&blob)).ok_or_else(|| format!("编译着色器 {entry:?} 未返回字节码"))
}

/// 编译（首次调用时）并返回全部着色器字节码。
pub fn bytecode() -> Result<&'static Bytecode, String> {
    BYTECODE
        .get_or_init(|| {
            let started = Instant::now();
            let code = Bytecode { planar: compile(c"planar")?, semiplanar: compile(c"semiplanar")?, compile_ms: started.elapsed().as_secs_f64() * 1000.0 };
            crate::logging::info("convert.shaders_compiled", "格式转换着色器已编译", serde_json::json!({ "compileMs": code.compile_ms }));
            Ok(code)
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// 与 `convert.hlsl` 的 `cbuffer Params` 同布局（全部 16 字节对齐的寄存器）。
#[repr(C)]
#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Params {
    pub size: [u32; 2],
    pub is_rgb: u32,
    pub has_alpha: u32,
    pub comp_layout: [[u32; 4]; 4],
    pub comp_format: [[u32; 4]; 4],
    pub plane_layout: [[u32; 4]; 4],
    pub chroma_log2: [u32; 2],
    pub has_chroma: u32,
    pub premultiplied: u32,
    pub range_y: [f32; 2],
    pub range_c: [f32; 2],
    pub coeff: [f32; 4],
    pub chroma_origin: [f32; 2],
    pub chroma_size: [u32; 2],
    pub extra: [f32; 4],
}

/// 一个平面的整块复制（源指针、在上传缓冲中的偏移、字节数）。
#[derive(Debug, Clone, Copy)]
pub struct PlaneCopy {
    pub source: *const u8,
    pub offset: usize,
    pub bytes: usize,
}

fn align(value: usize, to: usize) -> usize {
    value.div_ceil(to) * to
}

fn color_params(params: &mut Params, color: &ColorInfo, depth: u32, is_rgb: bool, log2: (u32, u32), visible: (u32, u32)) {
    let (range_y, range_c) = range_parameters(depth, color.full_range, is_rgb);
    let (kr, kb) = color.coefficients();
    params.range_y = range_y;
    params.range_c = range_c;
    params.coeff = [kr, kb, 1.0 - kr - kb, 0.0];
    params.chroma_log2 = [log2.0, log2.1];
    let origin = color.chroma_origin(log2.0, log2.1);
    params.chroma_origin = [origin.0, origin.1];
    params.chroma_size = [visible.0.div_ceil(1 << log2.0), visible.1.div_ceil(1 << log2.1)];
    params.size = [visible.0, visible.1];
}

/// 软解帧的着色器参数与平面复制清单（纯计算，除读帧字段外无副作用）。
///
/// # Safety
/// `frame` 必须是有效的软解 `AVFrame`。
pub unsafe fn planar_layout(frame: *const ff::AVFrame, color: &ColorInfo, premultiplied: bool) -> Result<(Params, Vec<PlaneCopy>, usize), String> {
    let frame = unsafe { &*frame };
    let format = crate::convert::pixel_format(frame.format).ok_or("帧像素格式无效")?;
    let descriptor = unsafe { ff::av_pix_fmt_desc_get(format) };
    if descriptor.is_null() {
        return Err("帧像素格式无描述".into());
    }
    let descriptor = unsafe { &*descriptor };
    let info = format_info(format).ok_or("帧像素格式无描述")?;
    let (width, height) = (frame.width as u32, frame.height as u32);
    let components = descriptor.nb_components as usize;
    // 逻辑分量：0=Y/R、1=U/G、2=V/B、3=A。
    let mapping: [Option<usize>; 4] = match components {
        1 => [Some(0), None, None, None],
        2 => [Some(0), None, None, Some(1)],
        3 => [Some(0), Some(1), Some(2), None],
        _ => [Some(0), Some(1), Some(2), Some(3)],
    };
    let plane_count = unsafe { ff::av_pix_fmt_count_planes(format) }.max(1) as usize;
    let has_chroma = !info.is_rgb && components >= 3;
    let mut params = Params::default();
    let mut copies = Vec::new();
    let mut offset = 0usize;
    for plane in 0..plane_count.min(4) {
        let linesize = frame.linesize[plane];
        if linesize <= 0 || frame.data[plane].is_null() {
            return Err(format!("平面 {plane} 行距 {linesize} 无效"));
        }
        // 只含色度分量的平面按色度高度计行数。
        let only_chroma = has_chroma && descriptor.comp[..components].iter().enumerate().filter(|(_, comp)| comp.plane as usize == plane).all(|(index, _)| index == 1 || index == 2);
        let rows = if only_chroma { height.div_ceil(1 << info.log2_chroma_h) } else { height } as usize;
        let bytes = linesize as usize * rows;
        params.plane_layout[plane] = [offset as u32, linesize as u32, 0, 0];
        copies.push(PlaneCopy { source: frame.data[plane], offset, bytes });
        offset = align(offset + bytes, 16);
    }
    for (logical, source) in mapping.iter().enumerate() {
        let Some(index) = source else { continue };
        let comp = &descriptor.comp[*index];
        let sample_bytes = if comp.depth + comp.shift > 8 { 2 } else { 1 };
        params.comp_layout[logical] = [comp.plane as u32, comp.offset as u32, comp.step as u32, comp.shift as u32];
        params.comp_format[logical] = [comp.depth as u32, sample_bytes, 0, 0];
    }
    params.is_rgb = info.is_rgb as u32;
    params.has_alpha = mapping[3].is_some() as u32;
    params.has_chroma = has_chroma as u32;
    params.premultiplied = premultiplied as u32;
    color_params(&mut params, color, info.depth, info.is_rgb, if has_chroma { (info.log2_chroma_w, info.log2_chroma_h) } else { (0, 0) }, (width, height));
    Ok((params, copies, offset.max(16)))
}

/// 软解 8 位 4:2:0 → NV12 中转纹理的行复制（按行区间分给多个线程）。
struct Nv12Copy {
    base: *mut u8,
    pitch: usize,
    chroma_offset: usize,
    planes: [*mut u8; 3],
    linesizes: [isize; 3],
    width: usize,
    height: usize,
    /// 源已是 NV12（色度交错）。
    interleaved: bool,
}

unsafe impl Sync for Nv12Copy {}

impl Nv12Copy {
    /// 复制亮度行 [start, end)（start 为偶数）及对应的色度行。
    unsafe fn copy_rows(&self, start: usize, end: usize) {
        if start >= end {
            return;
        }
        unsafe {
            for row in start..end {
                std::ptr::copy_nonoverlapping(self.planes[0].offset(row as isize * self.linesizes[0]), self.base.add(row * self.pitch), self.width);
            }
            let chroma_width = self.width.div_ceil(2);
            for row in (start / 2)..end.div_ceil(2).min(self.height.div_ceil(2)) {
                let target = self.base.add(self.chroma_offset + row * self.pitch);
                if self.interleaved {
                    std::ptr::copy_nonoverlapping(self.planes[1].offset(row as isize * self.linesizes[1]), target, chroma_width * 2);
                } else {
                    let u = self.planes[1].offset(row as isize * self.linesizes[1]);
                    let v = self.planes[2].offset(row as isize * self.linesizes[2]);
                    for column in 0..chroma_width {
                        *target.add(column * 2) = *u.add(column);
                        *target.add(column * 2 + 1) = *v.add(column);
                    }
                }
            }
        }
    }
}

struct SendPtr(*mut u8);
unsafe impl Send for SendPtr {}
unsafe impl Sync for SendPtr {}
impl SendPtr {
    /// 取指针（方法调用让闭包整体捕获 `SendPtr`，而不是按字段捕获裸指针）。
    fn get(&self) -> *mut u8 {
        self.0
    }
}

/// 把各平面复制到映射的上传缓冲；大平面分多线程。
///
/// # Safety
/// `destination` 至少可写 `copies` 覆盖的范围；源指针有效。
unsafe fn copy_planes(destination: *mut u8, copies: &[PlaneCopy]) {
    let total: usize = copies.iter().map(|copy| copy.bytes).sum();
    if total < PARALLEL_COPY_BYTES {
        for copy in copies {
            unsafe { std::ptr::copy_nonoverlapping(copy.source, destination.add(copy.offset), copy.bytes) };
        }
        return;
    }
    // 切成大致等长的块，分给少量线程。
    let chunk = total.div_ceil(COPY_THREADS);
    let mut jobs: Vec<(SendPtr, SendPtr, usize)> = Vec::new();
    for copy in copies {
        let mut done = 0;
        while done < copy.bytes {
            let length = chunk.min(copy.bytes - done);
            jobs.push((SendPtr(unsafe { copy.source.add(done) } as *mut u8), SendPtr(unsafe { destination.add(copy.offset + done) }), length));
            done += length;
        }
    }
    run_copies(jobs.into_iter().map(|(source, target, length)| move || unsafe { std::ptr::copy_nonoverlapping(source.get() as *const u8, target.get(), length) }).collect());
}

/// 软解平面的上传：CPU 写入 STAGING 缓冲环，再由显卡复制到着色器读取的 DEFAULT 缓冲。
/// 不用 DYNAMIC + WRITE_DISCARD：大缓冲的换名在驱动里可能退化成同步等待（1.3 验收中曾出现每帧 40ms 以上），
/// STAGING 环 + `MAP_FLAG_DO_NOT_WAIT` 轮转与 FFmpeg `hwupload`（D3D11）同一做法，耗时稳定。
struct UploadBuffer {
    staging: Vec<ID3D11Buffer>,
    next: usize,
    buffer: ID3D11Buffer,
    view: ID3D11ShaderResourceView,
    bytes: usize,
}

const UPLOAD_RING: usize = 3;

struct SemiTexture {
    texture: ID3D11Texture2D,
    luma: ID3D11ShaderResourceView,
    chroma: ID3D11ShaderResourceView,
    format: DXGI_FORMAT,
}

/// 每会话一个写入器（资源按需创建，随会话释放）。
pub struct Converter {
    gpu: Arc<GpuDevice>,
    /// 池纹理尺寸（nv12 为偶数）。
    pool: (u32, u32),
    /// 实际画面尺寸。
    visible: (u32, u32),
    constants: Option<ID3D11Buffer>,
    planar_shader: Option<ID3D11ComputeShader>,
    semi_shader: Option<ID3D11ComputeShader>,
    upload: Option<UploadBuffer>,
    semi: Option<SemiTexture>,
    target: Option<(ID3D11Texture2D, ID3D11UnorderedAccessView)>,
    staging: Vec<ID3D11Texture2D>,
    staging_next: usize,
    sws: *mut ff::SwsContext,
    fallback: *mut ff::AVFrame,
    pub fallback_used: bool,
}

// 只在会话线程里使用；COM 接口与 FFmpeg 对象不跨线程共享。
unsafe impl Send for Converter {}

impl Drop for Converter {
    fn drop(&mut self) {
        unsafe {
            if !self.sws.is_null() {
                ff::sws_freeContext(self.sws);
            }
            if !self.fallback.is_null() {
                ff::av_frame_free(&mut self.fallback);
            }
        }
    }
}

fn acquire(slot: &SharedSlot) -> Result<(), String> {
    if let Some(mutex) = &slot.keyed_mutex {
        // windows-rs 把 WAIT_TIMEOUT 这类成功码当作 Ok，需直接看 HRESULT。
        let result = unsafe { (Interface::vtable(mutex).AcquireSync)(Interface::as_raw(mutex), 0, KEYED_MUTEX_TIMEOUT_MS) };
        if result.0 == WAIT_TIMEOUT.0 as i32 {
            return Err("等待键控互斥体超时".into());
        }
        result.ok().map_err(|error| format!("获取键控互斥体失败：{error}"))?;
    }
    Ok(())
}

fn release(slot: &SharedSlot, context: &ID3D11DeviceContext) -> Result<(), String> {
    if let Some(mutex) = &slot.keyed_mutex {
        unsafe { mutex.ReleaseSync(0) }.map_err(|error| format!("释放键控互斥体失败：{error}"))?;
    }
    unsafe { context.Flush() };
    Ok(())
}

impl Converter {
    pub fn new(gpu: Arc<GpuDevice>, pool: (u32, u32), visible: (u32, u32)) -> Self {
        Self {
            gpu,
            pool,
            visible,
            constants: None,
            planar_shader: None,
            semi_shader: None,
            upload: None,
            semi: None,
            target: None,
            staging: Vec::new(),
            staging_next: 0,
            sws: std::ptr::null_mut(),
            fallback: std::ptr::null_mut(),
            fallback_used: false,
        }
    }

    fn device(&self) -> &ID3D11Device {
        &self.gpu.device
    }

    fn shader(&mut self, semi: bool) -> Result<ID3D11ComputeShader, String> {
        let existing = if semi { &self.semi_shader } else { &self.planar_shader };
        if let Some(shader) = existing {
            return Ok(shader.clone());
        }
        let code = bytecode()?;
        let mut shader = None;
        unsafe { self.device().CreateComputeShader(if semi { &code.semiplanar } else { &code.planar }, None, Some(&mut shader)) }.map_err(|error| format!("创建计算着色器失败：{error}"))?;
        let shader = shader.ok_or("CreateComputeShader 未返回对象")?;
        if semi {
            self.semi_shader = Some(shader.clone());
        } else {
            self.planar_shader = Some(shader.clone());
        }
        Ok(shader)
    }

    fn constants(&mut self) -> Result<ID3D11Buffer, String> {
        if let Some(buffer) = &self.constants {
            return Ok(buffer.clone());
        }
        let desc = D3D11_BUFFER_DESC {
            ByteWidth: align(std::mem::size_of::<Params>(), 16) as u32,
            Usage: D3D11_USAGE_DYNAMIC,
            BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32,
            CPUAccessFlags: D3D11_CPU_ACCESS_WRITE.0 as u32,
            MiscFlags: 0,
            StructureByteStride: 0,
        };
        let mut buffer = None;
        unsafe { self.device().CreateBuffer(&desc, None, Some(&mut buffer)) }.map_err(|error| format!("创建常量缓冲失败：{error}"))?;
        let buffer = buffer.ok_or("CreateBuffer 未返回对象")?;
        self.constants = Some(buffer.clone());
        Ok(buffer)
    }

    /// rgbaf16 着色器输出目标（带 UAV 的私有纹理，写完后整体复制到共享槽位）。
    fn target(&mut self) -> Result<(ID3D11Texture2D, ID3D11UnorderedAccessView), String> {
        if let Some(target) = &self.target {
            return Ok(target.clone());
        }
        let desc = D3D11_TEXTURE2D_DESC {
            Width: self.pool.0,
            Height: self.pool.1,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_R16G16B16A16_FLOAT,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_UNORDERED_ACCESS.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut texture = None;
        unsafe { self.device().CreateTexture2D(&desc, None, Some(&mut texture)) }.map_err(|error| format!("创建转换目标纹理失败：{error}"))?;
        let texture = texture.ok_or("CreateTexture2D 未返回对象")?;
        let mut view = None;
        unsafe { self.device().CreateUnorderedAccessView(&texture, None, Some(&mut view)) }.map_err(|error| format!("创建 UAV 失败：{error}"))?;
        let target = (texture, view.ok_or("CreateUnorderedAccessView 未返回对象")?);
        self.target = Some(target.clone());
        Ok(target)
    }

    fn ensure_upload(&mut self, bytes: usize) -> Result<(), String> {
        if self.upload.as_ref().is_some_and(|upload| upload.bytes >= bytes) {
            return Ok(());
        }
        let size = align(bytes, 1 << 20);
        let create = |usage: D3D11_USAGE, bind: u32, cpu: u32, misc: u32| -> Result<ID3D11Buffer, String> {
            let desc = D3D11_BUFFER_DESC { ByteWidth: size as u32, Usage: usage, BindFlags: bind, CPUAccessFlags: cpu, MiscFlags: misc, StructureByteStride: 0 };
            let mut buffer = None;
            unsafe { self.gpu.device.CreateBuffer(&desc, None, Some(&mut buffer)) }.map_err(|error| format!("创建上传缓冲（{size} 字节）失败：{error}"))?;
            buffer.ok_or_else(|| "CreateBuffer 未返回对象".to_string())
        };
        let buffer = create(D3D11_USAGE_DEFAULT, D3D11_BIND_SHADER_RESOURCE.0 as u32, 0, D3D11_RESOURCE_MISC_BUFFER_ALLOW_RAW_VIEWS.0 as u32)?;
        let staging = (0..UPLOAD_RING).map(|_| create(D3D11_USAGE_STAGING, 0, D3D11_CPU_ACCESS_WRITE.0 as u32, 0)).collect::<Result<Vec<_>, _>>()?;
        let view_desc = D3D11_SHADER_RESOURCE_VIEW_DESC {
            Format: DXGI_FORMAT_R32_TYPELESS,
            ViewDimension: D3D11_SRV_DIMENSION_BUFFEREX,
            Anonymous: D3D11_SHADER_RESOURCE_VIEW_DESC_0 { BufferEx: D3D11_BUFFEREX_SRV { FirstElement: 0, NumElements: (size / 4) as u32, Flags: D3D11_BUFFEREX_SRV_FLAG_RAW.0 as u32 } },
        };
        let mut view = None;
        unsafe { self.device().CreateShaderResourceView(&buffer, Some(&view_desc), Some(&mut view)) }.map_err(|error| format!("创建上传缓冲视图失败：{error}"))?;
        let view = view.ok_or("CreateShaderResourceView 未返回对象")?;
        self.upload = Some(UploadBuffer { staging, next: 0, buffer, view, bytes: size });
        Ok(())
    }

    /// 映射环里下一个空闲的 STAGING 缓冲（显卡仍在读的跳过；都忙时等当前这个）。返回缓冲与写入指针。
    fn map_staging(&mut self) -> Result<(ID3D11Buffer, *mut u8), String> {
        let upload = self.upload.as_mut().ok_or("上传缓冲未建立")?;
        let context = self.gpu.lock();
        for attempt in 0..=UPLOAD_RING {
            let index = upload.next % UPLOAD_RING;
            let staging = upload.staging[index].clone();
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            let flags = if attempt < UPLOAD_RING { D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32 } else { 0 };
            match unsafe { context.Map(&staging, 0, D3D11_MAP_WRITE, flags, Some(&mut mapped)) } {
                Ok(()) => {
                    upload.next += 1;
                    return Ok((staging, mapped.pData as *mut u8));
                }
                Err(error) if error.code() == DXGI_ERROR_WAS_STILL_DRAWING && attempt < UPLOAD_RING => upload.next += 1,
                Err(error) => return Err(format!("映射上传缓冲失败：{error}")),
            }
        }
        Err("映射上传缓冲失败".into())
    }

    fn semi_texture(&mut self, format: DXGI_FORMAT) -> Result<(ID3D11Texture2D, ID3D11ShaderResourceView, ID3D11ShaderResourceView), String> {
        if let Some(semi) = &self.semi {
            if semi.format == format {
                return Ok((semi.texture.clone(), semi.luma.clone(), semi.chroma.clone()));
            }
        }
        let (width, height) = (self.pool.0.next_multiple_of(2), self.pool.1.next_multiple_of(2));
        let desc = D3D11_TEXTURE2D_DESC {
            Width: width,
            Height: height,
            MipLevels: 1,
            ArraySize: 1,
            Format: format,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let mut texture = None;
        unsafe { self.device().CreateTexture2D(&desc, None, Some(&mut texture)) }.map_err(|error| format!("创建中间纹理失败：{error}"))?;
        let texture = texture.ok_or("CreateTexture2D 未返回对象")?;
        let (luma_format, chroma_format) = if format == DXGI_FORMAT_P010 { (DXGI_FORMAT_R16_UNORM, DXGI_FORMAT_R16G16_UNORM) } else { (DXGI_FORMAT_R8_UNORM, DXGI_FORMAT_R8G8_UNORM) };
        let view = |view_format: DXGI_FORMAT| -> Result<ID3D11ShaderResourceView, String> {
            let desc = D3D11_SHADER_RESOURCE_VIEW_DESC {
                Format: view_format,
                ViewDimension: D3D11_SRV_DIMENSION_TEXTURE2D,
                Anonymous: D3D11_SHADER_RESOURCE_VIEW_DESC_0 { Texture2D: D3D11_TEX2D_SRV { MostDetailedMip: 0, MipLevels: 1 } },
            };
            let mut view = None;
            unsafe { self.gpu.device.CreateShaderResourceView(&texture, Some(&desc), Some(&mut view)) }.map_err(|error| format!("创建平面视图失败：{error}"))?;
            view.ok_or_else(|| "CreateShaderResourceView 未返回对象".to_string())
        };
        let (luma, chroma) = (view(luma_format)?, view(chroma_format)?);
        self.semi = Some(SemiTexture { texture: texture.clone(), luma: luma.clone(), chroma: chroma.clone(), format });
        Ok((texture, luma, chroma))
    }

    fn staging_texture(&mut self) -> Result<ID3D11Texture2D, String> {
        const RING: usize = 3;
        if self.staging.len() < RING {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: self.pool.0,
                Height: self.pool.1,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_NV12,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_WRITE.0 as u32,
                MiscFlags: 0,
            };
            let mut texture = None;
            unsafe { self.device().CreateTexture2D(&desc, None, Some(&mut texture)) }.map_err(|error| format!("创建 NV12 中转纹理失败：{error}"))?;
            self.staging.push(texture.ok_or("CreateTexture2D 未返回对象")?);
        }
        let texture = self.staging[self.staging_next % self.staging.len()].clone();
        self.staging_next += 1;
        Ok(texture)
    }

    fn write_constants(context: &ID3D11DeviceContext, buffer: &ID3D11Buffer, params: &Params) -> Result<(), String> {
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        unsafe { context.Map(buffer, 0, D3D11_MAP_WRITE_DISCARD, 0, Some(&mut mapped)) }.map_err(|error| format!("映射常量缓冲失败：{error}"))?;
        unsafe {
            std::ptr::copy_nonoverlapping(params as *const Params as *const u8, mapped.pData as *mut u8, std::mem::size_of::<Params>());
            context.Unmap(buffer, 0);
        }
        Ok(())
    }

    /// 在已持锁的上下文上调度着色器并把结果复制到槽位（调用方已取得槽位的键控互斥体）。
    fn dispatch(&self, context: &ID3D11DeviceContext, shader: &ID3D11ComputeShader, constants: &ID3D11Buffer, views: &[Option<ID3D11ShaderResourceView>], target: &(ID3D11Texture2D, ID3D11UnorderedAccessView), slot: &SharedSlot) {
        unsafe {
            context.CSSetShader(shader, None);
            context.CSSetConstantBuffers(0, Some(&[Some(constants.clone())]));
            context.CSSetShaderResources(0, Some(views));
            let uav = Some(target.1.clone());
            context.CSSetUnorderedAccessViews(0, 1, Some(&uav), None);
            context.Dispatch(self.visible.0.div_ceil(8), self.visible.1.div_ceil(8), 1);
            let empty: Vec<Option<ID3D11ShaderResourceView>> = vec![None; views.len()];
            context.CSSetShaderResources(0, Some(&empty));
            let none: Option<ID3D11UnorderedAccessView> = None;
            context.CSSetUnorderedAccessViews(0, 1, Some(&none), None);
            context.CSSetShader(None::<&ID3D11ComputeShader>, None);
            context.CopyResource(&slot.texture, &target.0);
        }
    }

    /// 写入一帧。`path` 由会话按帧格式选好；`premultiplied` 为源透明是否预乘。
    ///
    /// # Safety
    /// `frame` 必须是有效帧；硬件帧须来自同一 D3D11 设备。
    pub unsafe fn write(&mut self, frame: *const ff::AVFrame, slot: &SharedSlot, path: WritePath, color: &ColorInfo, premultiplied: bool) -> Result<WriteStats, String> {
        match path {
            WritePath::CopyNv12 => unsafe { self.copy_nv12(frame, slot) },
            WritePath::ShaderSemiPlanar => unsafe { self.semiplanar(frame, slot, color) },
            WritePath::UploadNv12 => unsafe { self.upload_nv12(frame, slot) },
            WritePath::ShaderPlanar => unsafe { self.planar(frame, slot, color, premultiplied) },
            WritePath::CpuFallback => {
                let converted = unsafe { self.cpu_convert(frame, color)? };
                self.fallback_used = true;
                let started = Instant::now();
                let mut stats = unsafe { self.planar(converted, slot, color, premultiplied)? };
                stats.upload_us += started.elapsed().as_micros() as u64;
                Ok(stats)
            }
        }
    }

    unsafe fn copy_nv12(&mut self, frame: *const ff::AVFrame, slot: &SharedSlot) -> Result<WriteStats, String> {
        let (texture, index) = unsafe { super::d3d11va::frame_texture(frame) };
        let source = unsafe { ID3D11Texture2D::from_raw_borrowed(&texture) }.ok_or("硬件帧缺少纹理")?;
        let started = Instant::now();
        acquire(slot)?;
        let context = self.gpu.lock();
        let region = D3D11_BOX { left: 0, top: 0, front: 0, right: self.pool.0, bottom: self.pool.1, back: 1 };
        unsafe { context.CopySubresourceRegion(&slot.texture, 0, 0, 0, 0, source, index, Some(&region)) };
        release(slot, &context)?;
        Ok(WriteStats { upload_us: 0, submit_us: started.elapsed().as_micros() as u64, map_us: 0 })
    }

    unsafe fn semiplanar(&mut self, frame: *const ff::AVFrame, slot: &SharedSlot, color: &ColorInfo) -> Result<WriteStats, String> {
        let sw_format = unsafe { crate::decode::codec::frame_sw_format(frame) }.ok_or("硬件帧缺少帧池信息")?;
        let p010 = sw_format == ff::AVPixelFormat::AV_PIX_FMT_P010LE;
        let (texture, index) = unsafe { super::d3d11va::frame_texture(frame) };
        let source = unsafe { ID3D11Texture2D::from_raw_borrowed(&texture) }.ok_or("硬件帧缺少纹理")?.clone();
        let (semi, luma, chroma) = self.semi_texture(if p010 { DXGI_FORMAT_P010 } else { DXGI_FORMAT_NV12 })?;
        let shader = self.shader(true)?;
        let constants = self.constants()?;
        let target = self.target()?;
        let mut params = Params::default();
        color_params(&mut params, color, if p010 { 10 } else { 8 }, false, (1, 1), self.visible);
        params.has_chroma = 1;
        params.extra = [if p010 { 65535.0 / 64.0 } else { 255.0 }, 0.0, 0.0, 0.0];
        let started = Instant::now();
        acquire(slot)?;
        let context = self.gpu.lock();
        let region = D3D11_BOX { left: 0, top: 0, front: 0, right: self.pool.0.next_multiple_of(2), bottom: self.pool.1.next_multiple_of(2), back: 1 };
        unsafe { context.CopySubresourceRegion(&semi, 0, 0, 0, 0, &source, index, Some(&region)) };
        Self::write_constants(&context, &constants, &params)?;
        self.dispatch(&context, &shader, &constants, &[None, Some(luma), Some(chroma)], &target, slot);
        release(slot, &context)?;
        Ok(WriteStats { upload_us: 0, submit_us: started.elapsed().as_micros() as u64, map_us: 0 })
    }

    unsafe fn upload_nv12(&mut self, frame: *const ff::AVFrame, slot: &SharedSlot) -> Result<WriteStats, String> {
        let source = unsafe { &*frame };
        let staging = self.staging_texture()?;
        let started = Instant::now();
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        {
            let context = self.gpu.lock();
            unsafe { context.Map(&staging, 0, D3D11_MAP_WRITE, 0, Some(&mut mapped)) }.map_err(|error| format!("映射 NV12 中转纹理失败：{error}"))?;
        }
        let pitch = mapped.RowPitch as usize;
        let (width, height) = (self.visible.0 as usize, self.visible.1 as usize);
        let layout = Nv12Copy {
            base: mapped.pData as *mut u8,
            pitch,
            chroma_offset: pitch * self.pool.1 as usize,
            planes: [source.data[0], source.data[1], source.data[2]],
            linesizes: [source.linesize[0] as isize, source.linesize[1] as isize, source.linesize[2] as isize],
            width,
            height,
            interleaved: source.format == ff::AVPixelFormat::AV_PIX_FMT_NV12 as c_int,
        };
        let rows_per_job = height.div_ceil(COPY_THREADS).next_multiple_of(2);
        let layout = &layout;
        run_copies((0..COPY_THREADS).map(|job| move || unsafe { layout.copy_rows(job * rows_per_job, ((job + 1) * rows_per_job).min(height)) }).collect());
        let upload_us = started.elapsed().as_micros() as u64;
        let submitted = Instant::now();
        acquire(slot).inspect_err(|_| {
            let context = self.gpu.lock();
            unsafe { context.Unmap(&staging, 0) };
        })?;
        let context = self.gpu.lock();
        unsafe {
            context.Unmap(&staging, 0);
            context.CopyResource(&slot.texture, &staging);
        }
        release(slot, &context)?;
        Ok(WriteStats { upload_us, submit_us: submitted.elapsed().as_micros() as u64, map_us: 0 })
    }

    unsafe fn planar(&mut self, frame: *const ff::AVFrame, slot: &SharedSlot, color: &ColorInfo, premultiplied: bool) -> Result<WriteStats, String> {
        let (params, copies, bytes) = unsafe { planar_layout(frame, color, premultiplied)? };
        self.ensure_upload(bytes)?;
        let shader = self.shader(false)?;
        let constants = self.constants()?;
        let target = self.target()?;
        let started = Instant::now();
        let (staging, pointer) = self.map_staging()?;
        let map_us = started.elapsed().as_micros() as u64;
        unsafe { copy_planes(pointer, &copies) };
        let upload_us = started.elapsed().as_micros() as u64;
        let (buffer, view) = self.upload.as_ref().map(|upload| (upload.buffer.clone(), upload.view.clone())).ok_or("上传缓冲未建立")?;
        let submitted = Instant::now();
        acquire(slot).inspect_err(|_| {
            let context = self.gpu.lock();
            unsafe { context.Unmap(&staging, 0) };
        })?;
        let context = self.gpu.lock();
        unsafe {
            context.Unmap(&staging, 0);
            context.CopyResource(&buffer, &staging);
        }
        Self::write_constants(&context, &constants, &params)?;
        self.dispatch(&context, &shader, &constants, &[Some(view)], &target, slot);
        release(slot, &context)?;
        Ok(WriteStats { upload_us, submit_us: submitted.elapsed().as_micros() as u64, map_us })
    }

    /// 罕见格式的 CPU 回落：swscale 转为 16 位平面（不缩放、范围不变）。
    unsafe fn cpu_convert(&mut self, frame: *const ff::AVFrame, color: &ColorInfo) -> Result<*const ff::AVFrame, String> {
        let source = unsafe { &*frame };
        let source_format = crate::convert::pixel_format(source.format).ok_or("帧像素格式无效")?;
        let info = format_info(source_format).ok_or("帧像素格式无描述")?;
        let target_format = fallback_format(info.is_rgb, info.has_alpha);
        unsafe {
            if self.fallback.is_null() || (*self.fallback).width != source.width || (*self.fallback).height != source.height || (*self.fallback).format != target_format as c_int {
                ff::av_frame_free(&mut self.fallback);
                if !self.sws.is_null() {
                    ff::sws_freeContext(self.sws);
                    self.sws = std::ptr::null_mut();
                }
                self.fallback = ff::av_frame_alloc();
                (*self.fallback).width = source.width;
                (*self.fallback).height = source.height;
                (*self.fallback).format = target_format as c_int;
                if ff::av_frame_get_buffer(self.fallback, 0) < 0 {
                    return Err("分配 CPU 回落帧失败".into());
                }
                let flags = ff::SwsFlags::SWS_BILINEAR as c_int | ff::SwsFlags::SWS_ACCURATE_RND as c_int;
                self.sws = ff::sws_getContext(source.width, source.height, source_format, source.width, source.height, target_format, flags, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null());
                if self.sws.is_null() {
                    return Err(format!("swscale 不支持 {} → 16 位平面", info.name));
                }
                let range = color.full_range as c_int;
                let table = ff::sws_getCoefficients(ff::SWS_CS_DEFAULT);
                ff::sws_setColorspaceDetails(self.sws, table, range, table, range, 0, 1 << 16, 1 << 16);
            }
            ff::sws_scale(self.sws, source.data.as_ptr() as *const *const u8, source.linesize.as_ptr(), 0, source.height, (*self.fallback).data.as_ptr() as *const *mut u8, (*self.fallback).linesize.as_ptr());
        }
        Ok(self.fallback)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 3.2：上传复制在常驻线程上执行（反复调用不新建线程），结果与直接复制逐字节一致。
    #[test]
    fn upload_copies_run_on_resident_threads_and_match_a_direct_copy() {
        let planes: Vec<Vec<u8>> = (0..3usize).map(|plane| (0..3 * 1024 * 1024).map(|index| ((index * 7 + plane * 13) % 251) as u8).collect()).collect();
        let mut offset = 0;
        let copies: Vec<PlaneCopy> = planes.iter().map(|plane| { let copy = PlaneCopy { source: plane.as_ptr(), offset, bytes: plane.len() }; offset += plane.len(); copy }).collect();
        assert!(offset >= PARALLEL_COPY_BYTES, "要走并行复制分支");
        let mut destination = vec![0u8; offset];
        unsafe { copy_planes(destination.as_mut_ptr(), &copies) };
        assert!(destination == planes.concat(), "并行复制结果应与直接复制一致");
        let threads = std::sync::Mutex::new(std::collections::HashSet::new());
        for _ in 0..200 {
            run_copies((0..COPY_THREADS).map(|_| || { threads.lock().unwrap().insert(std::thread::current().id()); }).collect());
        }
        let used = threads.lock().unwrap().len();
        assert!(used >= 1 && used <= COPY_THREADS, "200 次 × {COPY_THREADS} 个任务只应用到常驻的 {COPY_THREADS} 个线程，实际 {used} 个");
    }

    #[test]
    fn shaders_compile() {
        let code = bytecode().expect("着色器应能编译");
        assert!(code.planar.len() > 100 && code.semiplanar.len() > 100);
    }

    #[test]
    fn params_layout_matches_hlsl_registers() {
        // 18 个 16 字节寄存器：与 convert.hlsl 的 cbuffer 一一对应。
        assert_eq!(std::mem::size_of::<Params>(), 18 * 16);
        assert_eq!(std::mem::offset_of!(Params, comp_layout), 16);
        assert_eq!(std::mem::offset_of!(Params, chroma_log2), 16 + 3 * 64);
        assert_eq!(std::mem::offset_of!(Params, extra), 17 * 16);
    }

    fn frame(format: ff::AVPixelFormat, width: i32, height: i32) -> *mut ff::AVFrame {
        unsafe {
            let frame = ff::av_frame_alloc();
            (*frame).format = format as c_int;
            (*frame).width = width;
            (*frame).height = height;
            assert!(ff::av_frame_get_buffer(frame, 0) >= 0);
            frame
        }
    }

    fn color() -> ColorInfo {
        ColorInfo::resolve(ff::AVColorSpace::AVCOL_SPC_BT709, ff::AVColorPrimaries::AVCOL_PRI_BT709, ff::AVColorTransferCharacteristic::AVCOL_TRC_BT709, ff::AVColorRange::AVCOL_RANGE_MPEG, ff::AVChromaLocation::AVCHROMA_LOC_LEFT, ff::AVPixelFormat::AV_PIX_FMT_YUV420P)
    }

    #[test]
    fn planar_layouts() {
        unsafe {
            let mut prores = frame(ff::AVPixelFormat::AV_PIX_FMT_YUVA444P12LE, 2560, 2560);
            let (params, copies, bytes) = planar_layout(prores, &color(), false).unwrap();
            assert_eq!(copies.len(), 4);
            assert_eq!(params.comp_layout[3][0], 3, "alpha 在第 4 平面");
            assert_eq!(params.comp_format[0], [12, 2, 0, 0]);
            assert_eq!(params.has_alpha, 1);
            assert_eq!(params.chroma_log2, [0, 0]);
            assert_eq!(params.range_y, [256.0, 3504.0]);
            assert!(bytes >= 4 * 2560 * 2560 * 2);
            ff::av_frame_free(&mut prores);

            let mut dnx = frame(ff::AVPixelFormat::AV_PIX_FMT_YUV422P10LE, 3840, 2160);
            let (params, copies, _) = planar_layout(dnx, &color(), false).unwrap();
            assert_eq!(copies.len(), 3);
            assert_eq!(params.chroma_log2, [1, 0]);
            assert_eq!(params.chroma_size, [1920, 2160]);
            assert_eq!(params.chroma_origin, [0.5, 0.5]);
            assert_eq!(params.has_alpha, 0);
            assert_eq!(copies[1].bytes, (*dnx).linesize[1] as usize * 2160, "4:2:2 色度平面高度不减半");
            ff::av_frame_free(&mut dnx);

            let mut yuv420 = frame(ff::AVPixelFormat::AV_PIX_FMT_YUV420P10LE, 1919, 1079);
            let (params, copies, _) = planar_layout(yuv420, &color(), false).unwrap();
            assert_eq!(copies[1].bytes, (*yuv420).linesize[1] as usize * 540);
            assert_eq!(params.chroma_size, [960, 540]);
            ff::av_frame_free(&mut yuv420);

            let mut gbrp = frame(ff::AVPixelFormat::AV_PIX_FMT_GBRP12LE, 64, 64);
            let (params, _, _) = planar_layout(gbrp, &color(), false).unwrap();
            assert_eq!(params.is_rgb, 1);
            assert_eq!(params.comp_layout[0][0], 2, "R 在第 3 平面");
            assert_eq!(params.range_y, [0.0, 4095.0]);
            ff::av_frame_free(&mut gbrp);

            let mut packed = frame(ff::AVPixelFormat::AV_PIX_FMT_YUYV422, 64, 64);
            let (params, copies, _) = planar_layout(packed, &color(), false).unwrap();
            assert_eq!(copies.len(), 1);
            assert_eq!(params.comp_layout[1], [0, 1, 4, 0], "U：平面 0、偏移 1、步长 4");
            ff::av_frame_free(&mut packed);
        }
    }
}
