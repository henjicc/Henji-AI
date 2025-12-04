# Kling Video v2.6 Text to Video

> Kling 2.6 Pro: Top-tier text-to-video with cinematic visuals, fluid motion, and native audio generation.


## Overview

- **Endpoint**: `https://fal.run/fal-ai/kling-video/v2.6/pro/text-to-video`
- **Model ID**: `fal-ai/kling-video/v2.6/pro/text-to-video`
- **Category**: text-to-video
- **Kind**: inference


## API Information

This model can be used via our HTTP API or more conveniently via our client libraries.
See the input and output schema below, as well as the usage examples.


### Input Schema

The API accepts the following input parameters:


- **`prompt`** (`string`, _required_)
  - Examples: "Old friends reuniting at a train station after 20 years, one exclaims 'Is that really you?!' other tearfully replies 'I promised I'd come back, didn't I?', train whistle, steam hissing, emotional orchestral swell, crowd murmur"

- **`duration`** (`DurationEnum`, _optional_):
  The duration of the generated video in seconds Default value: `"5"`
  - Default: `"5"`
  - Options: `"5"`, `"10"`

- **`aspect_ratio`** (`AspectRatioEnum`, _optional_):
  The aspect ratio of the generated video frame Default value: `"16:9"`
  - Default: `"16:9"`
  - Options: `"16:9"`, `"9:16"`, `"1:1"`

- **`negative_prompt`** (`string`, _optional_):
   Default value: `"blur, distort, and low quality"`
  - Default: `"blur, distort, and low quality"`

- **`cfg_scale`** (`float`, _optional_):
  The CFG (Classifier Free Guidance) scale is a measure of how close you want
  the model to stick to your prompt. Default value: `0.5`
  - Default: `0.5`
  - Range: `0` to `1`

- **`generate_audio`** (`boolean`, _optional_):
  Whether to generate native audio for the video. Supports Chinese and English voice output. Other languages are automatically translated to English. For English speech, use lowercase letters; for acronyms or proper nouns, use uppercase. Default value: `true`
  - Default: `true`



**Required Parameters Example**:

```json
{
  "prompt": "Old friends reuniting at a train station after 20 years, one exclaims 'Is that really you?!' other tearfully replies 'I promised I'd come back, didn't I?', train whistle, steam hissing, emotional orchestral swell, crowd murmur"
}
```

**Full Example**:

```json
{
  "prompt": "Old friends reuniting at a train station after 20 years, one exclaims 'Is that really you?!' other tearfully replies 'I promised I'd come back, didn't I?', train whistle, steam hissing, emotional orchestral swell, crowd murmur",
  "duration": "5",
  "aspect_ratio": "16:9",
  "negative_prompt": "blur, distort, and low quality",
  "cfg_scale": 0.5,
  "generate_audio": true
}
```


### Output Schema

The API returns the following output format:

- **`video`** (`File`, _required_):
  The generated video
  - Examples: {"file_size":8195664,"file_name":"output.mp4","content_type":"video/mp4","url":"https://v3b.fal.media/files/b/0a84ab71/8hPbLs7n59WhWY-BN69yX_output.mp4"}



**Example Response**:

```json
{
  "video": {
    "file_size": 8195664,
    "file_name": "output.mp4",
    "content_type": "video/mp4",
    "url": "https://v3b.fal.media/files/b/0a84ab71/8hPbLs7n59WhWY-BN69yX_output.mp4"
  }
}
```


## Usage Examples

### cURL

```bash
curl --request POST \
  --url https://fal.run/fal-ai/kling-video/v2.6/pro/text-to-video \
  --header "Authorization: Key $FAL_KEY" \
  --header "Content-Type: application/json" \
  --data '{
     "prompt": "Old friends reuniting at a train station after 20 years, one exclaims 'Is that really you?!' other tearfully replies 'I promised I'd come back, didn't I?', train whistle, steam hissing, emotional orchestral swell, crowd murmur"
   }'
```

### Python

Ensure you have the Python client installed:

```bash
pip install fal-client
```

Then use the API client to make requests:

```python
import fal_client

def on_queue_update(update):
    if isinstance(update, fal_client.InProgress):
        for log in update.logs:
           print(log["message"])

result = fal_client.subscribe(
    "fal-ai/kling-video/v2.6/pro/text-to-video",
    arguments={
        "prompt": "Old friends reuniting at a train station after 20 years, one exclaims 'Is that really you?!' other tearfully replies 'I promised I'd come back, didn't I?', train whistle, steam hissing, emotional orchestral swell, crowd murmur"
    },
    with_logs=True,
    on_queue_update=on_queue_update,
)
print(result)
```

### JavaScript

Ensure you have the JavaScript client installed:

```bash
npm install --save @fal-ai/client
```

Then use the API client to make requests:

```javascript
import { fal } from "@fal-ai/client";

const result = await fal.subscribe("fal-ai/kling-video/v2.6/pro/text-to-video", {
  input: {
    prompt: "Old friends reuniting at a train station after 20 years, one exclaims 'Is that really you?!' other tearfully replies 'I promised I'd come back, didn't I?', train whistle, steam hissing, emotional orchestral swell, crowd murmur"
  },
  logs: true,
  onQueueUpdate: (update) => {
    if (update.status === "IN_PROGRESS") {
      update.logs.map((log) => log.message).forEach(console.log);
    }
  },
});
console.log(result.data);
console.log(result.requestId);
```


## Additional Resources

### Documentation

- [Model Playground](https://fal.ai/models/fal-ai/kling-video/v2.6/pro/text-to-video)
- [API Documentation](https://fal.ai/models/fal-ai/kling-video/v2.6/pro/text-to-video/api)
- [OpenAPI Schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/kling-video/v2.6/pro/text-to-video)

### fal.ai Platform

- [Platform Documentation](https://docs.fal.ai)
- [Python Client](https://docs.fal.ai/clients/python)
- [JavaScript Client](https://docs.fal.ai/clients/javascript)
