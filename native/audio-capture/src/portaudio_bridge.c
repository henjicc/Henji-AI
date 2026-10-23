/* PortAudio ABI 只在这里使用；回调不分配、不写盘、不等待。 */
#include "portaudio.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#include <windows.h>
#include "pa_win_wasapi.h"
#ifdef HENJI_ASIO
#include "pa_asio.h"
#endif
#else
#include <mach/mach_time.h>
#endif

typedef struct { int device, first, channels, rate, format, frames; double latency; int exclusive; } Options;
typedef struct { int api, inputs, outputs; double rate, low_in, high_in, low_out, high_out; const char *name; } Device;
typedef void (*Sink)(void *, const float *, int, double, double, unsigned long, unsigned long);
typedef struct { PaStream *stream; Options options; int input_channels, first, calibrated; Sink sink; void *user; double rate, latency, clock_offset, next_us; } Capture;

double hc_clock(void) {
#ifdef _WIN32
    LARGE_INTEGER counter, frequency;
    QueryPerformanceCounter(&counter); QueryPerformanceFrequency(&frequency);
    return (double)counter.QuadPart * 1000000.0 / (double)frequency.QuadPart;
#else
    mach_timebase_info_data_t timebase; mach_timebase_info(&timebase);
    return (double)mach_absolute_time() * timebase.numer / timebase.denom / 1000.0;
#endif
}
int hc_init(void) { return Pa_Initialize(); }
const char *hc_last_error(void) { return Pa_GetLastHostErrorInfo()->errorText; }
void hc_terminate(void) { Pa_Terminate(); }
int hc_count(void) { return Pa_GetDeviceCount(); }
int hc_default(void) { return Pa_GetDefaultInputDevice(); }
int hc_hosts(void) { return Pa_GetHostApiCount(); }
const char *hc_host(int index, int *type, int *device) {
    const PaHostApiInfo *info = Pa_GetHostApiInfo(index);
    if (!info) return NULL;
    *type = info->type; *device = info->defaultInputDevice; return info->name;
}
int hc_device(int index, Device *out) {
    const PaDeviceInfo *d = Pa_GetDeviceInfo(index);
    if (!d) return paInvalidDevice;
    out->api = Pa_GetHostApiInfo(d->hostApi)->type; out->name = d->name;
    out->inputs = d->maxInputChannels; out->outputs = d->maxOutputChannels;
    out->rate = d->defaultSampleRate; out->low_in = d->defaultLowInputLatency;
    out->high_in = d->defaultHighInputLatency; out->low_out = d->defaultLowOutputLatency; out->high_out = d->defaultHighOutputLatency;
    return 0;
}
int hc_asio(void) {
#ifdef HENJI_ASIO
    return 1;
#else
    return 0;
#endif
}
int hc_panel(int device) {
#ifdef HENJI_ASIO
    return PaAsio_ShowControlPanel(device, NULL);
#else
    (void)device; return paIncompatibleStreamHostApi;
#endif
}
int hc_buffers(int device, long *minimum, long *maximum, long *preferred, long *granularity) {
#ifdef HENJI_ASIO
    return PaAsio_GetAvailableBufferSizes(device, minimum, maximum, preferred, granularity);
#else
    (void)device; (void)minimum; (void)maximum; (void)preferred; (void)granularity; return paIncompatibleStreamHostApi;
#endif
}
static float sample(const unsigned char *p, int format) {
    if (format == 16) { int16_t v; memcpy(&v, p, 2); return v / 32768.0f; }
    if (format == 24) { int32_t v = (int32_t)((uint32_t)p[0] << 8 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 24); return (v >> 8) / 8388608.0f; }
    { float v; memcpy(&v, p, 4); return v; }
}
static int callback(const void *input, void *output, unsigned long frames, const PaStreamCallbackTimeInfo *time, PaStreamCallbackFlags flags, void *user) {
    Capture *c = (Capture *)user;
    float samples[2048];
    unsigned long offset, i; int ch;
    int bytes = c->options.format == 16 ? 2 : c->options.format == 24 ? 3 : 4;
    double now = hc_clock();
    double delay = time->currentTime - time->inputBufferAdcTime;
    int valid = time->inputBufferAdcTime > 0 && delay >= 0 && delay < 10;
    double first, uncertainty;
    if (!c->calibrated && valid) { c->clock_offset = now - time->currentTime * 1000000; c->calibrated = 1; }
    first = valid ? time->inputBufferAdcTime * 1000000 + c->clock_offset : now - c->latency * 1000000;
    uncertainty = valid ? 1000.0 : (c->latency + frames / c->rate) * 1000000;
    /* 某些 MME 驱动的批量回调给出重复 ADC 时间；保留样本序和显式误差，不能让时钟回退。 */
    if (first < c->next_us) { uncertainty += c->next_us - first; first = c->next_us; }
    c->next_us = first + frames * 1000000.0 / c->rate;
    (void)output;
    for (offset = 0; offset < frames; offset += 1024) {
        unsigned long count = frames - offset < 1024 ? frames - offset : 1024;
        for (i = 0; i < count; ++i) for (ch = 0; ch < c->options.channels; ++ch) {
            size_t index = ((offset + i) * c->input_channels + c->first + ch) * bytes;
            samples[i * c->options.channels + ch] = input ? sample((const unsigned char *)input + index, c->options.format) : 0;
        }
        c->sink(c->user, samples, (int)count, first + offset * 1000000.0 / c->rate,
            uncertainty, flags | (input ? 0 : paInputUnderflow), frames);
    }
    return paContinue;
}
/* 同一参数构造供探测和打开使用，避免“支持”与实际录音语义漂移。 */
static int open_or_probe(Options *o, Capture *c) {
    const PaDeviceInfo *d = Pa_GetDeviceInfo(o->device);
    PaStreamParameters p; int api;
#ifdef _WIN32
    PaWasapiStreamInfo wasapi;
#ifdef HENJI_ASIO
    PaAsioStreamInfo asio; int selectors[2];
#endif
#endif
    if (!d) return paInvalidDevice;
    if (o->channels < 1 || o->channels > 2 || o->first < 0 || o->first + o->channels > d->maxInputChannels) return paInvalidChannelCount;
    api = Pa_GetHostApiInfo(d->hostApi)->type;
    memset(&p, 0, sizeof(p));
    p.device = o->device; p.channelCount = o->first + o->channels;
    p.sampleFormat = o->format == 16 ? paInt16 : o->format == 24 ? paInt24 : paFloat32;
    p.suggestedLatency = o->latency > 0 ? o->latency : d->defaultLowInputLatency;
    if (o->exclusive && api != paWASAPI) return paIncompatibleStreamHostApi;
#ifdef _WIN32
    if (api == paWASAPI) {
        memset(&wasapi, 0, sizeof(wasapi)); wasapi.size = sizeof(wasapi); wasapi.hostApiType = paWASAPI; wasapi.version = 1;
        wasapi.flags = o->exclusive ? paWinWasapiExclusive : 0; p.hostApiSpecificStreamInfo = &wasapi;
    }
#ifdef HENJI_ASIO
    if (api == paASIO) {
        memset(&asio, 0, sizeof(asio)); asio.size = sizeof(asio); asio.hostApiType = paASIO; asio.version = 1;
        asio.flags = paAsioUseChannelSelectors; selectors[0] = o->first; selectors[1] = o->first + 1;
        asio.channelSelectors = selectors; p.hostApiSpecificStreamInfo = &asio; p.channelCount = o->channels;
        if (c) {
            long minimum, maximum, preferred, granularity;
            /* ASIO 以驱动当前采样率和首选缓冲为准，不偷偷重配控制面板。 */
            o->rate = (int)d->defaultSampleRate; o->frames = 0;
            if (PaAsio_GetAvailableBufferSizes(o->device, &minimum, &maximum, &preferred, &granularity) == 0)
                p.suggestedLatency = (double)preferred / o->rate;
        }
    }
#endif
#endif
    if (!c) return Pa_IsFormatSupported(&p, NULL, o->rate);
    c->options = *o; c->input_channels = p.channelCount; c->first = api == paASIO ? 0 : o->first;
    c->rate = o->rate; c->latency = p.suggestedLatency;
    { int error = Pa_OpenStream(&c->stream, &p, NULL, o->rate, o->frames, paClipOff, callback, c);
      if (!error) { const PaStreamInfo *info = Pa_GetStreamInfo(c->stream); c->rate = info->sampleRate; c->latency = info->inputLatency; }
      return error; }
}
int hc_probe(Options *o) { return open_or_probe(o, NULL); }
Capture *hc_open(Options *o, Sink sink, void *user, int *error, double *rate, double *latency) {
    Capture *c = (Capture *)calloc(1, sizeof(Capture));
    if (!c) { *error = paInsufficientMemory; return NULL; }
    c->sink = sink; c->user = user; *error = open_or_probe(o, c);
    if (*error) { free(c); return NULL; }
    *rate = c->rate; *latency = c->latency; return c;
}
int hc_start(Capture *c) { c->calibrated = 0; return Pa_StartStream(c->stream); }
int hc_stop(Capture *c) { int active = Pa_IsStreamActive(c->stream); return active == 1 ? Pa_StopStream(c->stream) : active < 0 ? active : 0; }
int hc_active(Capture *c) { return Pa_IsStreamActive(c->stream); }
void hc_close(Capture *c) { Pa_CloseStream(c->stream); free(c); }
