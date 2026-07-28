// WebGPU Worker 多尺度摄影柔光着色器。
// 所有散射在 Linear sRGB 代理空间完成，半径来自共享归一化配方。
//
// 采样一律使用 textureSampleLevel(..., 0.0)：本着色器的输入纹理都只有 1 级 mip
// （创建时未传 mipLevelCount，采样器也没有 mipmapFilter），显式 LOD 与隐式求导结果
// 完全一致；而 textureSample 依赖隐式求导，要求调用点处于一致控制流，会与 alpha
// 提前返回、色散开关等分支冲突并直接导致整个 shader module 编译失败。

/** 裁切高光外推的最大增益，防止把纯白面积重建成不受控的光源。 */
const MAX_RECOVERY_GAIN: f32 = 3.0;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local_uv: vec2<f32>,
};

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
  );
  let position = positions[index];
  var output: VertexOutput;
  output.position = vec4<f32>(position, 0.0, 1.0);
  output.local_uv = vec2<f32>(
    (position.x + 1.0) * 0.5,
    1.0 - (position.y + 1.0) * 0.5
  );
  return output;
}

fn luminance(color: vec3<f32>) -> f32 {
  return dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
}

struct SourceUniforms {
  scale: vec2<f32>,
  offset: vec2<f32>,
  threshold_ev: f32,
  soft_knee_ev: f32,
  power: f32,
  highlight_gain: f32,
  micro_gain: f32,
  highlight_recovery: f32,
  mode: f32,
  padding: f32,
};

@group(0) @binding(0) var source_input: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> source_params: SourceUniforms;

/**
 * 高光响应在 EV(log2) 空间求值。
 *
 * 线性空间里同一个 knee 宽度，在不同阈值处对应的感知过渡宽度会随亮度指数漂移，
 * 导致「柔化拐点」与「阈值」两个参数互相干扰、亮部过渡突兀。EV 空间下 knee 是
 * 恒定的档位宽度，两个参数才正交。
 */
fn highlight_response(value: f32) -> f32 {
  let ev = log2(max(value, 1e-6) / 0.18);
  let knee = max(source_params.soft_knee_ev, 1e-3);
  let shoulder = clamp(
    (ev - source_params.threshold_ev + knee) / (2.0 * knee),
    0.0,
    1.0
  );
  let smooth_shoulder = shoulder * shoulder * (3.0 - 2.0 * shoulder);
  return pow(smooth_shoulder, max(source_params.power, 0.1));
}

/**
 * 数字 Bloom 的亮通提取。用 max RGB 而非亮度判断高亮，避免纯蓝、纯红等高饱和
 * 光源因为感知亮度系数偏低而无法稳定进入辉光。软拐点只提取阈值以上的增量，
 * 不复制整块高光核心，因此强度拉高也不会把亮边继续推成大片死白。
 */
fn bloom_bright_pass(color: vec3<f32>) -> vec3<f32> {
  let brightness = max(color.r, max(color.g, color.b));
  let threshold = 0.18 * exp2(source_params.threshold_ev);
  let knee = max(
    threshold * clamp(source_params.soft_knee_ev / 2.4, 0.1, 0.5),
    1e-5
  );
  var soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  let contribution = max(brightness - threshold, soft) / max(brightness, 1e-5);
  return color * contribution * source_params.highlight_gain;
}

@fragment
fn fragment_source(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = source_params.offset + input.local_uv * source_params.scale;
  let color = textureSampleLevel(source_input, source_sampler, uv, 0.0);
  if (color.a <= 0.00001) {
    return vec4<f32>(0.0);
  }
  if (source_params.mode > 1.5) {
    return vec4<f32>(bloom_bright_pass(color.rgb) * color.a, color.a);
  }
  let luma = luminance(color.rgb);
  let highlight = highlight_response(luma);
  let micro = luma * luma * source_params.micro_gain;

  // 裁切高光恢复：JPEG 已把过曝区削平，真实峰值不可知。按接近饱和的程度做有界外推，
  // 且只用于生成散射源、不改写可见原图（文档 §7）。
  let peak = max(color.r, max(color.g, color.b));
  let clipped = smoothstep(0.94, 1.0, peak);
  let recovery = 1.0 + clipped * source_params.highlight_recovery * MAX_RECOVERY_GAIN;

  var response = color.rgb * (
    highlight * source_params.highlight_gain * recovery + micro
  );
  if (source_params.mode < 0.5) {
    response *= mix(0.65, 1.0, highlight);
  } else if (source_params.mode < 1.5) {
    response += color.rgb * micro * 0.45;
  }
  // 散射源不得超过像素自身的光量：物理上不可能从一个像素取走比它更多的光。
  // 不在源头封顶的话，合成阶段的 min() 会截断扣除项而加回项照旧，
  // 参数一拉高就变成凭空造光、整图发亮（文档 §3）。
  let emitted = clamp(response, vec3<f32>(0.0), color.rgb);
  return vec4<f32>(emitted * color.a, color.a);
}

struct BlurUniforms {
  scale: vec2<f32>,
  offset: vec2<f32>,
  aspect_correction: vec2<f32>,
  radius: f32,
  axis: f32,
};

@group(0) @binding(0) var blur_input: texture_2d<f32>;
@group(0) @binding(1) var blur_sampler: sampler;
@group(0) @binding(2) var<uniform> blur_params: BlurUniforms;

fn blur_direction() -> vec2<f32> {
  let selected = select(
    vec2<f32>(1.0, 0.0),
    vec2<f32>(0.0, 1.0),
    blur_params.axis > 0.5
  );
  return selected * blur_params.aspect_correction * blur_params.radius;
}

fn gaussian_sample(uv: vec2<f32>, direction: vec2<f32>) -> vec4<f32> {
  var result = textureSampleLevel(blur_input, blur_sampler, uv, 0.0) * 0.227027;
  result += textureSampleLevel(blur_input, blur_sampler, uv + direction * 1.384615, 0.0) * 0.316216;
  result += textureSampleLevel(blur_input, blur_sampler, uv - direction * 1.384615, 0.0) * 0.316216;
  result += textureSampleLevel(blur_input, blur_sampler, uv + direction * 3.230769, 0.0) * 0.070270;
  result += textureSampleLevel(blur_input, blur_sampler, uv - direction * 3.230769, 0.0) * 0.070270;
  return result;
}

/**
 * Bloom 降采样使用全正权重的 13-tap tent 核。采样间距永远是输入纹理的相邻 texel，
 * 半径由 mip 层级累积形成，不再把任意大半径乘到稀疏五点核上制造亮边复本。
 */
fn bloom_downsample(uv: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(blur_input));
  let texel = vec2<f32>(1.0) / max(dimensions, vec2<f32>(1.0));
  let half_texel = texel * 0.5;
  var result = textureSampleLevel(blur_input, blur_sampler, uv, 0.0) * 0.125;
  result += (
    textureSampleLevel(blur_input, blur_sampler, uv + vec2<f32>(texel.x, 0.0), 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv - vec2<f32>(texel.x, 0.0), 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv + vec2<f32>(0.0, texel.y), 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv - vec2<f32>(0.0, texel.y), 0.0)
  ) * 0.0625;
  result += (
    textureSampleLevel(blur_input, blur_sampler, uv + texel, 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv - texel, 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv + vec2<f32>(texel.x, -texel.y), 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv + vec2<f32>(-texel.x, texel.y), 0.0)
  ) * 0.03125;
  result += (
    textureSampleLevel(blur_input, blur_sampler, uv + half_texel, 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv - half_texel, 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv + vec2<f32>(half_texel.x, -half_texel.y), 0.0)
    + textureSampleLevel(blur_input, blur_sampler, uv + vec2<f32>(-half_texel.x, half_texel.y), 0.0)
  ) * 0.125;
  return result;
}

@fragment
fn fragment_blur_horizontal(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = blur_params.offset + input.local_uv * blur_params.scale;
  return gaussian_sample(uv, blur_direction());
}

@fragment
fn fragment_blur_vertical(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = blur_params.offset + input.local_uv * blur_params.scale;
  return gaussian_sample(uv, blur_direction());
}

@fragment
fn fragment_bloom_downsample(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = blur_params.offset + input.local_uv * blur_params.scale;
  return bloom_downsample(uv);
}

@group(0) @binding(10) var bloom_low_input: texture_2d<f32>;

fn bloom_upsample_low(uv: vec2<f32>) -> vec4<f32> {
  let dimensions = vec2<f32>(textureDimensions(bloom_low_input));
  let texel = vec2<f32>(1.0) / max(dimensions, vec2<f32>(1.0));
  var result = textureSampleLevel(bloom_low_input, blur_sampler, uv, 0.0) * 0.25;
  result += (
    textureSampleLevel(bloom_low_input, blur_sampler, uv + vec2<f32>(texel.x, 0.0), 0.0)
    + textureSampleLevel(bloom_low_input, blur_sampler, uv - vec2<f32>(texel.x, 0.0), 0.0)
    + textureSampleLevel(bloom_low_input, blur_sampler, uv + vec2<f32>(0.0, texel.y), 0.0)
    + textureSampleLevel(bloom_low_input, blur_sampler, uv - vec2<f32>(0.0, texel.y), 0.0)
  ) * 0.125;
  result += (
    textureSampleLevel(bloom_low_input, blur_sampler, uv + texel, 0.0)
    + textureSampleLevel(bloom_low_input, blur_sampler, uv - texel, 0.0)
    + textureSampleLevel(bloom_low_input, blur_sampler, uv + vec2<f32>(texel.x, -texel.y), 0.0)
    + textureSampleLevel(bloom_low_input, blur_sampler, uv + vec2<f32>(-texel.x, texel.y), 0.0)
  ) * 0.0625;
  return result;
}

@fragment
fn fragment_bloom_upsample(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = blur_params.offset + input.local_uv * blur_params.scale;
  let high = textureSampleLevel(blur_input, blur_sampler, uv, 0.0);
  return high * blur_params.radius + bloom_upsample_low(uv) * blur_params.axis;
}

struct CompositeUniforms {
  scale: vec2<f32>,
  offset: vec2<f32>,
  weights_a: vec4<f32>,
  weights_b: vec4<f32>,
  scatter_fraction: f32,
  veil: f32,
  black_retention: f32,
  highlight_compression: f32,
  scatter_desaturation: f32,
  high_frequency_retention: f32,
  mid_frequency_retention: f32,
  mode: f32,
  tint_rgb: vec3<f32>,
  tint_amount: f32,
  tint_gain: f32,
  glow_exposure: f32,
  glow_shoulder_knee: f32,
  glow_bleach: f32,
  glow_core_weight: f32,
  glow_tint_core_white: f32,
  padding_a: f32,
  padding_b: f32,
};

@group(0) @binding(0) var composite_base: texture_2d<f32>;
@group(0) @binding(1) var composite_sampler: sampler;
@group(0) @binding(2) var scatter_0: texture_2d<f32>;
@group(0) @binding(3) var scatter_1: texture_2d<f32>;
@group(0) @binding(4) var scatter_2: texture_2d<f32>;
@group(0) @binding(5) var scatter_3: texture_2d<f32>;
@group(0) @binding(6) var scatter_4: texture_2d<f32>;
@group(0) @binding(7) var scatter_5: texture_2d<f32>;
@group(0) @binding(8) var<uniform> composite_params: CompositeUniforms;
/** 未经模糊的散射源 E，能量守恒的扣除项必须用它而不是模糊后的结果。 */
@group(0) @binding(9) var composite_emitted: texture_2d<f32>;

fn sample_scatter(texture: texture_2d<f32>, uv: vec2<f32>) -> vec3<f32> {
  return textureSampleLevel(texture, composite_sampler, uv, 0.0).rgb;
}

/** 归一化十字低通，权重 0.5 / 4×0.125，总和为 1，因此不改变局部平均亮度。 */
fn cross_lowpass(
  texture: texture_2d<f32>,
  uv: vec2<f32>,
  radius: f32
) -> vec3<f32> {
  let dimensions = vec2<f32>(textureDimensions(texture));
  let step = vec2<f32>(radius) / max(dimensions, vec2<f32>(1.0));
  let center = textureSampleLevel(texture, composite_sampler, uv, 0.0).rgb;
  let horizontal =
    textureSampleLevel(texture, composite_sampler, uv - vec2<f32>(step.x, 0.0), 0.0).rgb
    + textureSampleLevel(texture, composite_sampler, uv + vec2<f32>(step.x, 0.0), 0.0).rgb;
  let vertical =
    textureSampleLevel(texture, composite_sampler, uv - vec2<f32>(0.0, step.y), 0.0).rgb
    + textureSampleLevel(texture, composite_sampler, uv + vec2<f32>(0.0, step.y), 0.0).rgb;
  return center * 0.5 + (horizontal + vertical) * 0.125;
}

/**
 * 保色相高光滚降。
 *
 * 逐通道压缩会让不同通道压掉不同的量，一团红色光晕越亮越偏黄；这里只对峰值通道求
 * 肩部，其余通道等比跟随，色相与饱和比例都不动。肩部起点处一阶导为 1、随后渐近到
 * 1.0，不会出现硬截断的死白台阶。
 *
 * 压缩掉的量再按比例把颜色往白里推：真实过曝就是往白跑，只压不漂白会停在饱和色上，
 * 得到「有色但不亮」的塑料感。
 */
fn tonemap_glow(color: vec3<f32>, knee: f32, bleach: f32) -> vec3<f32> {
  let peak = max(color.r, max(color.g, color.b));
  if (knee >= 1.0 || peak <= knee) {
    return color;
  }
  let range = max(1.0 - knee, 1e-4);
  let rolled = knee + range * (1.0 - exp(-(peak - knee) / range));
  let scaled = color * (rolled / max(peak, 1e-5));
  let overflow = clamp((peak - rolled) / max(peak, 1e-5), 0.0, 1.0);
  return mix(scaled, vec3<f32>(rolled), overflow * bleach);
}

fn compress_highlight_channel(value: f32, amount: f32) -> f32 {
  let safe_value = max(value, 0.0);
  let shoulder = clamp(amount, 0.0, 0.45);
  if (shoulder <= 1e-5) {
    return safe_value;
  }
  let shoulder_start = 1.0 - shoulder;
  if (safe_value <= shoulder_start) {
    return safe_value;
  }
  // 起点处一阶导数为 1，随后渐近到 1；避免 FP16 合成超过 SDR 后被硬截断。
  return shoulder_start + shoulder * (
    1.0 - exp(-(safe_value - shoulder_start) / shoulder)
  );
}

fn compress_highlights(color: vec3<f32>, amount: f32) -> vec3<f32> {
  return vec3<f32>(
    compress_highlight_channel(color.r, amount),
    compress_highlight_channel(color.g, amount),
    compress_highlight_channel(color.b, amount)
  );
}

@fragment
fn fragment_composite(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = composite_params.offset + input.local_uv * composite_params.scale;
  let base = textureSampleLevel(composite_base, composite_sampler, uv, 0.0);
  if (base.a <= 0.00001) {
    return vec4<f32>(0.0);
  }
  var scatter = sample_scatter(scatter_0, uv);
  if (composite_params.mode < 1.5) {
    scatter *= composite_params.weights_a.x;
    scatter += sample_scatter(scatter_1, uv) * composite_params.weights_a.y;
    scatter += sample_scatter(scatter_2, uv) * composite_params.weights_a.z;
    scatter += sample_scatter(scatter_3, uv) * composite_params.weights_a.w;
    scatter += sample_scatter(scatter_4, uv) * composite_params.weights_b.x;
    scatter += sample_scatter(scatter_5, uv) * composite_params.weights_b.y;
  } else {
    // 辉光金字塔最紧一级在 1/2 分辨率，光源近处 2~3px 的过渡在那里够不到，光晕和
    // 光源核心之间会留一道断层。这里直接对全分辨率的亮通源做十字低通补上，
    // 比再挂两张全分辨率金字塔纹理便宜得多。互补加权、核权重总和为 1，
    // 因此调紧致度不会顺带增亮。
    //
    // 半径取 2 而不是 1：1 个 texel 的十字中心权重占一半，出来几乎还是原图，
    // 只等于给高光加了点亮度，看不出光晕；2 个 texel 才有可见的近场衰减。
    scatter = mix(
      scatter,
      cross_lowpass(composite_emitted, uv, 2.0),
      composite_params.glow_core_weight
    );
  }

  let scatter_luma = luminance(scatter);
  scatter = mix(
    scatter,
    vec3<f32>(scatter_luma),
    composite_params.scatter_desaturation
  );

  // 着色只作用于散射光，直接光不动，所以画面不会整体偏色。
  // tint_rgb 已在 CPU 侧归一到亮度 1，染色本身不改变散射光总量；
  // tint_gain 是刻意的艺术控制，会在 ±50% 内偏离能量守恒。
  scatter *= mix(vec3<f32>(1.0), composite_params.tint_rgb, composite_params.tint_amount);
  scatter *= composite_params.tint_gain;

  if (composite_params.mode > 1.5) {
    var bloom = scatter * composite_params.glow_exposure;

    // 强度渐变着色：辉光最亮处白热，只有尾部吃染色。平铺一个颜色会像蒙了张色纸，
    // 因为真实光源的核心总是先到白，再往外才显出颜色。
    let bloom_peak = max(bloom.r, max(bloom.g, bloom.b));
    let heat = smoothstep(0.35, 1.4, bloom_peak);
    bloom = mix(
      bloom,
      vec3<f32>(bloom_peak),
      heat * composite_params.glow_tint_core_white
    );

    // 线性相加，不按底图亮度做任何空间门控。
    //
    // 此前这里乘的是 headroom = 1 - 底图峰值：底图越亮能加的辉光越少，一个纯白灯泡
    // 处 headroom 直接归零——光源自己完全不发光，只有周围暗处才出现光晕，中心挖空
    // 往外冒，这是「贴图感」的主因。而且门控依据是底图亮度而非辉光形状，光晕里只要
    // 挡着一个亮物体，光晕就会沿那个物体的边缘被啃掉一块。
    //
    // 同理也不再做 bloom /= max(1, bloom_peak)：那是逐像素的非线性缩放，亮处压得多、
    // 暗处不压，等于直接把 PSF 的径向衰减曲线压平。
    //
    // 溢出统一交给末端的保色相肩部处理，这才是 SDR 收高光该用的手段。
    return vec4<f32>(
      tonemap_glow(
        base.rgb + bloom,
        composite_params.glow_shoulder_knee,
        composite_params.glow_bleach
      ),
      base.a
    );
  }

  // 能量守恒（文档 §4.2）：O = I - f·E + f·(K * E)。
  //
  // 扣除项必须用未模糊的源 E：模糊后的 scatter 在高光中心已被摊平，用它扣会扣得
  // 太少，中心不下沉，观感就是「贴上去的光晕」而不是「光从中心漏出去」。
  // 扣和加还必须用同一个系数，否则每提一档强度就是在凭空造光（文档 §3）。
  // 尺度权重与模糊核都已归一化到 1，因此全局能量自动守恒。
  let emitted = textureSampleLevel(composite_emitted, composite_sampler, uv, 0.0).rgb;
  let deduction = min(base.rgb, emitted * composite_params.scatter_fraction);
  let direct = max(base.rgb - deduction, vec3<f32>(0.0));
  var color = direct + scatter * composite_params.scatter_fraction;

  // 细节补偿必须来自底图频段，不能拿散射源代替：非高光区的散射源接近 0，
  // 用 base - scatter 会把整张底图当成「细节」重复加回。
  let near_base = cross_lowpass(composite_base, uv, 1.0);
  let far_base = cross_lowpass(composite_base, uv, 3.0);
  let high_detail = base.rgb - near_base;
  let mid_detail = near_base - far_base;
  color += high_detail * composite_params.high_frequency_retention * 0.08;
  color += mid_detail * composite_params.mid_frequency_retention * 0.04;

  // 雾幕抬黑位，是白柔区别于黑柔的核心特征（资料 §6.2）。
  if (composite_params.mode > 0.5 && composite_params.mode < 1.5) {
    color += vec3<f32>(composite_params.veil) * (0.2 + scatter_luma * 0.8);
  }

  // 黑位保持对两种柔光都有意义：黑柔靠它守住黑位，白柔靠它控制黑位被抬多少。
  // 辉光不主动抬黑位（资料 §6.3），没有需要「保持」的东西，故不参与。
  if (composite_params.mode < 1.5) {
    let shadow_response = smoothstep(0.0, 0.25, luminance(base.rgb));
    let black_guard = mix(
      1.0,
      shadow_response,
      composite_params.black_retention
    );
    color = mix(base.rgb, color, black_guard);
  }

  color = compress_highlights(color, composite_params.highlight_compression);
  return vec4<f32>(max(color, vec3<f32>(0.0)), base.a);
}
