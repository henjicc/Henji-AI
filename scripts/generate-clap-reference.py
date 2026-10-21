# CLAP 一致性测试的参考样本：用 transformers ClapProcessor（官方预处理与分词）和同一份 fp16 ONNX
# 生成合成信号的对数梅尔谱抽样值、音频/文本向量和分词结果，写入 tests/fixtures/sound-library/clap-reference.json。
# 用法：python -I scripts/generate-clap-reference.py <含 audio_model_fp16.onnx / text_model_fp16.onnx 的目录>
import json, math, os, sys
import numpy as np, onnxruntime as ort
from transformers import ClapProcessor

MODELS = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tests', 'fixtures', 'sound-library', 'clap-reference.json')
SR = 48000
processor = ClapProcessor.from_pretrained('laion/larger_clap_general')
extractor = processor.feature_extractor


def lcg(seed, count):
    out, state = np.empty(count, dtype=np.float64), seed
    for i in range(count):
        state = (state * 1664525 + 1013904223) % 4294967296
        out[i] = state / 4294967296 * 2 - 1
    return out


# 与 clapFeatures.test.ts 的 synthesize() 逐项相同：float64 计算后转 float32。
def synthesize(kind):
    if kind == 'whoosh':
        n = int(0.6 * SR); t = np.arange(n) / SR
        env = np.sin(np.pi * t / 0.6) ** 2
        return (0.5 * env * lcg(7, n) + 0.2 * env * np.sin(2 * np.pi * (300 + 2500 * t) * t)).astype(np.float32)
    if kind == 'ding':
        n = int(2.0 * SR); t = np.arange(n) / SR
        return (0.7 * np.exp(-3 * t) * (np.sin(2 * np.pi * 1760 * t) + 0.3 * np.sin(2 * np.pi * 3520 * t))).astype(np.float32)
    n = int(12.0 * SR); t = np.arange(n) / SR
    return (0.4 * np.sin(2 * np.pi * 220 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t)) + 0.05 * lcg(11, n)).astype(np.float32)


audio = ort.InferenceSession(os.path.join(MODELS, 'audio_model_fp16.onnx'), providers=['CPUExecutionProvider'])
text = ort.InferenceSession(os.path.join(MODELS, 'text_model_fp16.onnx'), providers=['CPUExecutionProvider'])
norm = lambda v: (v / np.linalg.norm(v)).tolist()
signals = []
for kind in ('whoosh', 'ding', 'long'):
    wave = synthesize(kind)
    # 长于 10 秒：与应用相同的确定性窗口（以第 7 秒为中心 → 2–12 秒），再交给官方提取器（不再触发随机截取）。
    if len(wave) > 480000:
        wave = wave[2 * SR:12 * SR]
    features = extractor(wave, sampling_rate=SR, return_tensors='np')['input_features'].astype(np.float32)
    flat = features.reshape(-1)
    embedding = audio.run(None, {'input_features': features})[0][0].astype(np.float64)
    signals.append({'kind': kind, 'melStride': 97, 'melSamples': [round(float(v), 4) for v in flat[::97]], 'melMean': float(flat.mean()), 'embedding': [round(v, 6) for v in norm(embedding)]})
prompts = ['a fast whoosh, air swoosh passing by', 'a bright ding bell chime notification', 'metal hit']
texts = []
for prompt in prompts:
    ids = processor.tokenizer([prompt], return_tensors='np')['input_ids'].astype(np.int64)
    embedding = text.run(None, {'input_ids': ids})[0][0].astype(np.float64)
    texts.append({'prompt': prompt, 'ids': ids[0].tolist(), 'embedding': [round(v, 6) for v in norm(embedding)]})
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf8') as file:
    json.dump({'source': 'transformers ClapProcessor laion/larger_clap_general + Xenova fp16 ONNX (CPU)', 'signals': signals, 'texts': texts}, file)
print('wrote', OUT)
