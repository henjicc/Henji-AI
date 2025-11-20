# Model Endpoints API | fal.ai Reference

> Model endpoints are the entry point to interact with the fal API. They are exposed through simple HTTP APIs that can be called from any programming language.

In the next sections you will learn how to call these endpoints in 3 ways:

* `https://queue.fal.run` exposes our [Queue](/model-apis/model-endpoints/queue), the recommended way to interact with the fal API
* `https://fal.run` allows [synchronous execution](/model-apis/model-endpoints/synchronous-requests) of models
* `wss://ws.fal.run` allows submitting requests via a [WebSocket connection](/model-apis/model-endpoints/websockets)

We also offer [clients](/model-apis/clients) for some of the popular programming languages used by our community.

<Warning>
  **There is no api.fal.ai domain**

  Note that the fal API does not use the `api.fal.ai` domain. Please refer to the 3 options above.
</Warning>
