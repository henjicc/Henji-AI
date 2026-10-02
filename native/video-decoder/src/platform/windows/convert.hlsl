// 原生解码帧 → rgbaf16（非线性 R'G'B'，非预乘 alpha）。运行时由 d3dcompiler_47 编译为 cs_5_0（convert/gpu.rs）。
//
// planar：软解帧各平面原样写入 ByteAddressBuffer，按像素格式描述（平面、偏移、步长、移位、位深）取样，
//         覆盖平面/半平面/打包 YUV、灰度、平面 RGB，8–16 位，含透明。
// semiplanar：硬解 NV12/P010 表面复制到中间纹理后读取（亮度 R8/R16 视图、色度 R8G8/R16G16 视图）。
//
// 色彩：按矩阵系数与范围把码值换成 R'G'B'，不做传输与色域换算（由 Chromium 按标注的色彩空间处理）；
// 色度按采样位置双线性上采样；结果截到 [0,1]（与 Chromium 对 YUV 外部纹理的输出一致）。

cbuffer Params : register(b0)
{
    uint2 size;           // 输出宽高
    uint isRgb;           // 平面 RGB（分量 0/1/2 = R/G/B）
    uint hasAlpha;
    uint4 compLayout[4];  // 每个逻辑分量（Y/R、U/G、V/B、A）：平面、字节偏移、步长、移位
    uint4 compFormat[4];  // 位深、每样本字节数
    uint4 planeLayout[4]; // 平面在缓冲中的起点、行距
    uint2 chromaLog2;     // 色度下采样（log2）
    uint hasChroma;
    uint premultiplied;   // 源为预乘透明：输出前反预乘
    float2 rangeY;        // 亮度（或 RGB）码值偏移、跨度
    float2 rangeC;        // 色度码值偏移、跨度
    float4 coeff;         // Kr、Kb、Kg
    float2 chromaOrigin;  // 色度样本 0 的中心位置（亮度像素单位）
    uint2 chromaSize;     // 色度平面尺寸（样本数）
    float4 extra;         // x：半平面纹理 unorm → 码值 的倍数
};

ByteAddressBuffer source : register(t0);
Texture2D<float> lumaPlane : register(t1);
Texture2D<float2> chromaPlane : register(t2);
RWTexture2D<float4> target : register(u0);

uint loadCode(uint component, uint x, uint y)
{
    uint4 layout = compLayout[component];
    uint4 format = compFormat[component];
    uint4 plane = planeLayout[layout.x];
    uint address = plane.x + y * plane.y + x * layout.z + layout.y;
    uint word = source.Load(address & ~3u);
    uint value = word >> ((address & 3u) * 8u);
    value &= format.y == 1u ? 0xFFu : 0xFFFFu;
    return (value >> layout.w) & ((1u << format.x) - 1u);
}

float3 toRgb(float yCode, float uCode, float vCode)
{
    float y = (yCode - rangeY.x) / rangeY.y;
    if (hasChroma == 0u)
        return float3(y, y, y);
    float cb = (uCode - rangeC.x) / rangeC.y;
    float cr = (vCode - rangeC.x) / rangeC.y;
    float kr = coeff.x;
    float kb = coeff.y;
    float r = y + 2.0 * (1.0 - kr) * cr;
    float b = y + 2.0 * (1.0 - kb) * cb;
    float g = (y - kr * r - kb * b) / coeff.z;
    return float3(r, g, b);
}

// 色度样本坐标（浮点，样本单位）。
float2 chromaPosition(uint2 pixel)
{
    float2 scale = float2(1u << chromaLog2.x, 1u << chromaLog2.y);
    return (float2(pixel) + 0.5 - chromaOrigin) / scale;
}

void bilinear(float2 position, out int2 p0, out int2 p1, out float2 t)
{
    float2 base = floor(position);
    t = position - base;
    int2 limit = int2(chromaSize) - 1;
    p0 = clamp(int2(base), 0, limit);
    p1 = clamp(int2(base) + 1, 0, limit);
}

float chromaFromBuffer(uint component, uint2 pixel)
{
    int2 p0, p1;
    float2 t;
    bilinear(chromaPosition(pixel), p0, p1, t);
    float a = loadCode(component, p0.x, p0.y);
    float b = loadCode(component, p1.x, p0.y);
    float c = loadCode(component, p0.x, p1.y);
    float d = loadCode(component, p1.x, p1.y);
    return lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y);
}

float4 finish(float3 rgb, float alpha)
{
    rgb = saturate(rgb);
    if (premultiplied != 0u && alpha > 0.0)
        rgb = saturate(rgb / alpha);
    return float4(rgb, alpha);
}

[numthreads(8, 8, 1)]
void planar(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= size.x || id.y >= size.y)
        return;
    float3 rgb;
    if (isRgb != 0u)
    {
        rgb = float3(loadCode(0, id.x, id.y), loadCode(1, id.x, id.y), loadCode(2, id.x, id.y)) / rangeY.y;
    }
    else
    {
        float yCode = loadCode(0, id.x, id.y);
        float uCode = 0.0;
        float vCode = 0.0;
        if (hasChroma != 0u)
        {
            uCode = chromaFromBuffer(1, id.xy);
            vCode = chromaFromBuffer(2, id.xy);
        }
        rgb = toRgb(yCode, uCode, vCode);
    }
    float alpha = 1.0;
    if (hasAlpha != 0u)
        alpha = loadCode(3, id.x, id.y) / (float)((1u << compFormat[3].x) - 1u);
    target[id.xy] = finish(rgb, alpha);
}

[numthreads(8, 8, 1)]
void semiplanar(uint3 id : SV_DispatchThreadID)
{
    if (id.x >= size.x || id.y >= size.y)
        return;
    float yCode = lumaPlane.Load(int3(id.xy, 0)) * extra.x;
    int2 p0, p1;
    float2 t;
    bilinear(chromaPosition(id.xy), p0, p1, t);
    float2 a = chromaPlane.Load(int3(p0.x, p0.y, 0));
    float2 b = chromaPlane.Load(int3(p1.x, p0.y, 0));
    float2 c = chromaPlane.Load(int3(p0.x, p1.y, 0));
    float2 d = chromaPlane.Load(int3(p1.x, p1.y, 0));
    float2 uv = lerp(lerp(a, b, t.x), lerp(c, d, t.x), t.y) * extra.x;
    target[id.xy] = finish(toRgb(yCode, uv.x, uv.y), 1.0);
}
