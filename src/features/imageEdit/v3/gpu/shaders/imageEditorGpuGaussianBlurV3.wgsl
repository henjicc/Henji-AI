// 核函数由 core/imaging/effects/wgsl/gaussian.ts 注入；这里只定义图片宿主 ABI。
struct Params {
 operation: vec4f,
 transfer: vec4f,
 domain: vec4f,
 targetOrigin: vec4f,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> params: Params;
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
 let p = position.xy + params.targetOrigin.xy;
 let sourcePosition = p * params.transfer.yz - 0.5;
 let size = vec2i(params.domain.xy); let origin = vec2i(params.domain.zw);
 let repeatEdges = params.transfer.w > 0.5;
 if (params.operation.x < 0.5) {
  return gaussianConvolve(source, sourcePosition, params.operation.yz, params.transfer.x, i32(params.operation.w), size, repeatEdges, origin);
 }
 return gaussianSample(source, sourcePosition, size, repeatEdges, origin);
}
