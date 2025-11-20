# Queue API | fal.ai Reference

> For requests that take longer than several seconds, as it is usually the case with AI models, we provide a queue system.

It offers granular control in dealing with surges in traffic, allows you to cancel requests and monitor the current position within the queue, and removes the need to keep long running connections open.

### Queue endpoints

The queue functionality is exposed via standardized per-model paths under `https://queue.fal.run`.

| Endpoint                                                                   | Method | Description                                          |
| :------------------------------------------------------------------------- | :----- | :--------------------------------------------------- |
| **`https://queue.fal.run/{model_id}`**                                     | POST   | Adds a request to the queue for a top-level path     |
| **`https://queue.fal.run/{model_id}/{subpath}`**                           | POST   | Adds a request to the queue for an optional subpath  |
| **`https://queue.fal.run/{model_id}/requests/{request_id}/status`**        | GET    | Gets the status of a request                         |
| **`https://queue.fal.run/{model_id}/requests/{request_id}/status/stream`** | GET    | Streams the status of a request until it's completed |
| **`https://queue.fal.run/{model_id}/requests/{request_id}`**               | GET    | Gets the response of a request                       |
| **`https://queue.fal.run/{model_id}/requests/{request_id}/cancel`**        | PUT    | Cancels a request that has not started processing    |

Parameters:

* `model_id`: the model ID consists of a namespace and model name separated by a slash, e.g. `fal-ai/fast-sdxl`. Many models expose only a single
  top-level endpoint, so you can directly call them by `model_id`.
* `subpath`: some models expose different capabilities at different sub-paths, e.g. `fal-ai/flux/dev`. The subpath (`/dev` in this case) should be used
  when making the request, but not when getting request status or results
* `request_id` is returned after adding a request to the queue. This is the identifier you use to check the status and get results and logs

### Submit a request

Here is an example of using curl to submit a request which will add it to the queue:

```bash  theme={null}
curl -X POST https://queue.fal.run/fal-ai/fast-sdxl \
  -H "Authorization: Key $FAL_KEY" \
  -d '{"prompt": "a cat"}'
```

Here's an example of a response with the `request_id`:

```json  theme={null}
{
  "request_id": "80e732af-660e-45cd-bd63-580e4f2a94cc",
  "response_url": "https://queue.fal.run/fal-ai/fast-sdxl/requests/80e732af-660e-45cd-bd63-580e4f2a94cc",
  "status_url": "https://queue.fal.run/fal-ai/fast-sdxl/requests/80e732af-660e-45cd-bd63-580e4f2a94cc/status",
  "cancel_url": "https://queue.fal.run/fal-ai/fast-sdxl/requests/80e732af-660e-45cd-bd63-580e4f2a94cc/cancel"
}
```

The payload helps you to keep track of your request with the `request_id`, and provides you with the necessary information to get the status of your request, cancel it or get the response once it's ready, so you don't have to build these endpoints yourself.

### Request status

Once you have the request id you may use this request id to get the status of the request. This endpoint will give you information about your request's status, it's position in the queue or the response itself if the response is ready.

```sh  theme={null}
curl -X GET https://queue.fal.run/fal-ai/fast-sdxl/requests/{request_id}/status
```

Here's an example of a response with the `IN_QUEUE` status:

```json  theme={null}
{
  "status": "IN_QUEUE",
  "queue_position": 0,
  "response_url": "https://queue.fal.run/fal-ai/fast-sdxl/requests/80e732af-660e-45cd-bd63-580e4f2a94cc"
}
```

#### Status types

Queue `status` can have one of the following types and their respective properties:

* **`IN_QUEUE`** (and status code 202):

  * `queue_position`: The current position of the task in the queue.
  * `response_url`: The URL where the response will be available once the task is processed.

* **`IN_PROGRESS`** (and status code 202):

  * `logs`: An array of logs related to the request. Note that it needs to be enabled, as explained in the next section.
  * `response_url`: The URL where the response will be available.

* **`COMPLETED`** (and status code 200):
  * `logs`: An array of logs related to the request. Note that it needs to be enabled, as explained in the next section.
  * `response_url`: The URL where the response is available.

#### Logs

Logs are disabled by default. In order to enable logs for your request, you need to send the `logs=1` query parameter when getting the status of your request. For example:

```sh  theme={null}
curl -X GET https://queue.fal.run/fal-ai/fast-sdxl/requests/{request_id}/status?logs=1
```

When enabled, the `logs` attribute in the queue status contains an array of log entries, each represented by the `RequestLog` type. A `RequestLog` object has the following attributes:

* `message`: a string containing the log message.
* `level`: the severity of the log, it can be one of the following:
  * `STDERR` | `STDOUT` | `ERROR` | `INFO` | `WARN` | `DEBUG`
* `source`: indicates the source of the log.
* `timestamp`: a string representing the time when the log was generated.

These logs offer valuable insights into the status and progress of your queued tasks, facilitating effective monitoring and debugging.

#### Streaming status

If you want to keep track of the status of your request in real-time, you can use the streaming endpoint.
The response is `text/event-stream` and each event is a JSON object with the status of the request exactly as the non-stream endpoint.

This endpoint will keep the connection open until the status of the request changes to `COMPLETED`.

It supports the same `logs` query parameter as the status.

```sh  theme={null}
curl -X GET https://queue.fal.run/fal-ai/fast-sdxl/requests/{request_id}/status/stream
```

Here is an example of a stream of status updates:

```bash  theme={null}
$ curl https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/status/stream?logs=1 --header "Authorization: Key $FAL_KEY"

data: {"status": "IN_PROGRESS", "request_id": "3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "response_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "status_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/status", "cancel_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/cancel", "logs": [], "metrics": {}}

data: {"status": "IN_PROGRESS", "request_id": "3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "response_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "status_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/status", "cancel_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/cancel", "logs": [{"timestamp": "2024-12-20T15:37:17.120314", "message": "INFO:TRYON:Preprocessing images...", "labels": {}}, {"timestamp": "2024-12-20T15:37:17.286519", "message": "INFO:TRYON:Running try-on model...", "labels": {}}], "metrics": {}}

data: {"status": "IN_PROGRESS", "request_id": "3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "response_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "status_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/status", "cancel_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/cancel", "logs": [], "metrics": {}}

: ping

data: {"status": "IN_PROGRESS", "request_id": "3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "response_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "status_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/status", "cancel_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/cancel", "logs": [], "metrics": {}}

data: {"status": "COMPLETED", "request_id": "3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "response_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf", "status_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/status", "cancel_url": "https://queue.fal.run/fashn/tryon/requests/3e3e5b55-45fb-4e5c-b4d1-05702dffc8bf/cancel", "logs": [{"timestamp": "2024-12-20T15:37:32.161184", "message": "INFO:TRYON:Finished running try-on model.", "labels": {}}], "metrics": {"inference_time": 17.795265674591064}}
```

### Cancelling a request

If your request has not started processing (status is `IN_QUEUE`), you may attempt to cancel it.

```sh  theme={null}
curl -X PUT https://queue.fal.run/fal-ai/fast-sdxl/requests/{request_id}/cancel
```

If the request has not already started processing, you will get a `202 Accepted` response with the following body:

```json  theme={null}
{
  "status": "CANCELLATION_REQUESTED"
}
```

Note that a request may still be executed after getting this response if it was very late in the queue process.

If the request is already processed, you will get a `400 Bad Request` response with this body:

```json  theme={null}
{
  "status": "ALREADY_COMPLETED"
}
```

### Getting the response

Once you get the `COMPLETED` status, the `response` will be available along with its `logs`.

The HTTP status code you get is typically the HTTP status code that was returned by the model. This way you can differentiate success (`200`) vs model error (`5XX`) vs invalid request (`4XX`). There are 2 exceptions:

* `404` if the request cannot be found
* `400` if the request has not been completed

```sh  theme={null}
curl -X GET https://queue.fal.run/fal-ai/fast-sdxl/requests/{request_id}
```

Here's an example of a response with the `COMPLETED` status:

```json  theme={null}
{
  "status": "COMPLETED",
  "logs": [
    {
      "message": "2020-05-04 14:00:00.000000",
      "level": "INFO",
      "source": "stdout",
      "timestamp": "2020-05-04T14:00:00.000000Z"
    }
  ],
  "response": {
    "message": "Hello World!"
  }
}
```

<Note>
  **A simple queue recipe**

  Submit your request and let our client handle the status tracking for you. The next section details how the fal client simplifies building apps with fal functions.
</Note>

### Using webhook callbacks

Instead of polling for the request status, you can have fal call a webhook when a request is finished. Please refer to the [Webhooks page](/model-apis/model-endpoints/webhooks).
