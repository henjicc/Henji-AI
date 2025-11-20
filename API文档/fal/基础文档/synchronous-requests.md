# Synchronous Requests API | fal.ai Reference

> While our [Queue system](/model-apis/model-endpoints/queue) is the more reliable and recommended way to submit requests, we also support synchronous requests via `https://fal.run`.

Synchronous endpoints are beneficial if when you know the request is quick and you are looking for minimal latency. The drawbacks are:

* You need to keep the connection open until receiving the result
* The request cannot be interrupted
* If the connection is interrupted there is not way to obtain the result
* You will be charged for the full request whether or not you were able to receive the result

The endpoint format and parameters are similar to the Queue ones:

| Endpoint                                   | Method | Description                                         |
| :----------------------------------------- | :----- | :-------------------------------------------------- |
| **`https://fal.run/{model_id}`**           | POST   | Adds a request to the queue for a top-level path    |
| **`https://fal.run/{model_id}/{subpath}`** | POST   | Adds a request to the queue for an optional subpath |

Parameters:

* `model_id`: the model ID consists of a namespace and model name separated by a slash, e.g. `fal-ai/fast-sdxl`. Many models expose only a single
  top-level endpoint, so you can directly call them by `model_id`.
* `subpath`: some models expose different capabilities at different sub-paths, e.g. `fal-ai/flux/dev`. The subpath (`/dev` in this case) should be used

### Submit a request

Here is an example of using the curl command to submit a synchronous request:

```bash  theme={null}
curl -X POST https://fal.run/fal-ai/fast-sdxl \
  -H "Authorization: Key $FAL_KEY" \
  -d '{"prompt": "a cat"}'
```

The response will come directly from the model:

```json  theme={null}
{
  "images": [
    {
      "url": "https://v3.fal.media/files/rabbit/YYbm6L3DaXYHDL1_A4OaL.jpeg",
      "width": 1024,
      "height": 1024,
      "content_type": "image/jpeg"
    }
  ],
  "timings": {
    "inference": 2.507048434985336
  },
  "seed": 15860307465884635512,
  "has_nsfw_concepts": [
    false
  ],
  "prompt": "a cat"
}
```
