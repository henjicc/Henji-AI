# Client Libraries

## Introduction

fal provides official client libraries for multiple programming languages, offering a seamless interface to interact with our platform.

## Supported Languages

We officially support the following languages:

<CardGroup cols={3}>
  <Card title="JavaScript/TypeScript" icon="js" />

  <Card title="Python" icon="python" />

  <Card title="Swift (iOS)" icon="swift" />

  <Card title="Java" icon="java" />

  <Card title="Kotlin" icon="code" />

  <Card title="Dart (Flutter)" icon="code" />
</CardGroup>

<Note>
  **Don't see your language?**

  We are working on adding support for more languages. Reach out on our [Discord Community](https://discord.gg/fal-ai) and let us know which language you would like to see next.

  In the meantime, you can use the [REST API directly](/model-apis/model-endpoints).
</Note>

## Installation

First, add the client as a dependency in your project:

<CodeGroup>
  ```bash npm theme={null}
  npm install --save @fal-ai/client
  ```

  ```bash yarn theme={null}
  yarn add @fal-ai/client
  ```

  ```bash pnpm theme={null}
  pnpm add @fal-ai/client
  ```

  ```bash bun theme={null}
  bun add @fal-ai/client
  ```

  ```bash pip theme={null}
  pip install fal-client
  ```

  ```bash Flutter theme={null}
  flutter pub add fal_client
  ```

  ```swift Swift Package theme={null}
  .package(url: "https://github.com/fal-ai/fal-swift.git", from: "0.5.6")
  ```

  ```groovy Gradle (Java) theme={null}
  implementation 'ai.fal.client:fal-client:0.7.1'
  ```

  ```xml Maven (Java) theme={null}
  <dependency>
    <groupId>ai.fal.client</groupId>
    <artifactId>fal-client</artifactId>
    <version>0.7.1</version>
  </dependency>
  ```

  ```groovy Gradle (Kotlin) theme={null}
  implementation 'ai.fal.client:fal-client-kotlin:0.7.1'
  ```

  ```xml Maven (Kotlin) theme={null}
  <dependency>
    <groupId>ai.fal.client</groupId>
    <artifactId>fal-client-kotlin</artifactId>
    <version>0.7.1</version>
  </dependency>
  ```
</CodeGroup>

<Note>
  **Java Async Support**

  If your code relies on asynchronous operations via `CompletableFuture` or `Future`, you can use the `ai.fal.client:fal-client-async` artifact instead, which contains the necessary APIs for asynchronous programming.
</Note>

## Features

### 1. Call an endpoint

Endpoints requests are managed by a queue system. This allows fal to provide a reliable and scalable service.

The `subscribe` method allows you to submit a request to the queue and wait for the result.

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const result = await fal.subscribe("fal-ai/flux/dev", {
    input: {
      prompt: "a cat",
      seed: 6252023,
      image_size: "landscape_4_3",
      num_images: 4,
    },
    logs: true,
    onQueueUpdate: (update) => {
      if (update.status === "IN_PROGRESS") {
        update.logs.map((log) => log.message).forEach(console.log);
      }
    },
    headers: { "X-Custom-Header": "value" }, // Optional: custom headers
  });

  console.log(result.data);
  console.log(result.requestId);
  ```

  ```python Python theme={null}
  import fal_client

  def on_queue_update(update):
      if isinstance(update, fal_client.InProgress):
          for log in update.logs:
             print(log["message"])

  result = fal_client.subscribe(
      "fal-ai/flux/dev",
      arguments={
          "prompt": "a cat",
          "seed": 6252023,
          "image_size": "landscape_4_3",
          "num_images": 4
      },
      with_logs=True,
      on_queue_update=on_queue_update,
      headers={"X-Custom-Header": "value"},  # Optional: custom headers
  )

  print(result)
  ```

  ```python Python (async) theme={null}
  import asyncio
  import fal_client

  async def subscribe():
      def on_queue_update(update):
          if isinstance(update, fal_client.InProgress):
              for log in update.logs:
                  print(log["message"])

      result = await fal_client.subscribe_async(
          "fal-ai/flux/dev",
          arguments={
              "prompt": "a cat",
              "seed": 6252023,
              "image_size": "landscape_4_3",
              "num_images": 4
          },
          on_queue_update=on_queue_update,
          headers={"X-Custom-Header": "value"},  # Optional: custom headers
      )

      print(result)


  if __name__ == "__main__":
      asyncio.run(subscribe())
  ```

  ```swift Swift theme={null}
  import FalClient

  let result = try await fal.subscribe(
      to: "fal-ai/flux/dev",
      input: [
          "prompt": "a cat",
          "seed": 6252023,
          "image_size": "landscape_4_3",
          "num_images": 4
      ],
      includeLogs: true
  ) { update in
      if case let .inProgress(logs) = update {
          print(logs)
      }
  }
  ```

  ```java Java theme={null}
  import ai.fal.client.*;
  import ai.fal.client.queue.*;

  var fal = FalClient.withEnvCredentials();

  var input = Map.of(
      "prompt", "a cat",
      "seed", 6252023,
      "image_size", "landscape_4_3",
      "num_images", 4
  );
  var result = fal.subscribe("fal-ai/flux/dev",
      SubscribeOptions.<JsonObject>builder()
          .input(input)
          .logs(true)
          .resultType(JsonObject.class)
          .onQueueUpdate(update -> {
              if (update instanceof QueueStatus.InProgress) {
                  System.out.println(((QueueStatus.InProgress) update).getLogs());
              }
          })
          .build()
  );
  ```

  ```kotlin Kotlin theme={null}
  import ai.fal.client.kt

  val fal = createFalClient()

  val input = mapOf<String, Any>(
      "prompt" to "a cat",
      "seed" to 6252023,
      "image_size" to "landscape_4_3",
      "num_images" to 4
  )
  val result = fal.subscribe("fal-ai/flux/dev", input, options = SubscribeOptions(
      logs = true
  )) { update ->
      if (update is QueueStatus.InProgress) {
        println(update.logs)
      }
  }
  ```

  ```dart Dart (Flutter) theme={null}
  import 'package:fal_client/fal_client.dart';

  final fal = FalClient.withCredentials("FAL_KEY");

  final output = await fal.subscribe("fal-ai/flux/dev",
    input: {
      "prompt": "a cat",
      "seed": 6252023,
      "image_size": "landscape_4_3",
      "num_images": 4
    },
    logs: true,
    webhookUrl: "https://optional.webhook.url/for/results",
    onQueueUpdate: (update) { print(update); }
  );
  print(output.requestId);
  print(output.data);
  ```
</CodeGroup>

### 2. Queue Management

You can manage the queue using the following methods:

#### Submit a Request

Submit a request to the queue using the `queue.submit` method.

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const { request_id } = await fal.queue.submit("fal-ai/flux/dev", {
    input: {
      prompt: "a cat",
      seed: 6252023,
      image_size: "landscape_4_3",
      num_images: 4,
    },
    webhookUrl: "https://optional.webhook.url/for/results",
    headers: { "X-Custom-Header": "value" }, // Optional: custom headers
  });
  ```

  ```python Python theme={null}
  import fal_client

  handler = fal_client.submit(
      "fal-ai/flux/dev",
      arguments={
          "prompt": "a cat",
          "seed": 6252023,
          "image_size": "landscape_4_3",
          "num_images": 4
      },
      webhook_url="https://optional.webhook.url/for/results",
      headers={"X-Custom-Header": "value"},  # Optional: custom headers
  )

  request_id = handler.request_id
  ```

  ```python Python (async) theme={null}
  import asyncio
  import fal_client

  async def submit():
      handler = await fal_client.submit_async(
          "fal-ai/flux/dev",
          arguments={
              "prompt": "a cat",
              "seed": 6252023,
              "image_size": "landscape_4_3",
              "num_images": 4
          },
          webhook_url="https://optional.webhook.url/for/results",
          headers={"X-Custom-Header": "value"},  # Optional: custom headers
      )

      request_id = handler.request_id
      print(request_id)
  ```

  ```swift Swift theme={null}
  import FalClient

  let job = try await fal.queue.submit(
      "fal-ai/flux/dev",
      input: [
          "prompt": "a cat",
          "seed": 6252023,
          "image_size": "landscape_4_3",
          "num_images": 4
      ],
      webhookUrl: "https://optional.webhook.url/for/results"
  )
  ```

  ```java Java theme={null}
  import ai.fal.client.*;
  import ai.fal.client.queue.*;

  var fal = FalClient.withEnvCredentials();

  var input = Map.of(
      "prompt", "a cat",
      "seed", 6252023,
      "image_size", "landscape_4_3",
      "num_images", 4
  );
  var job = fal.queue().submit("fal-ai/flux/dev",
      SubmitOptions.<JsonObject>builder()
          .input(input)
          .webhookUrl("https://optional.webhook.url/for/results")
          .resultType(JsonObject.class)
          .build()
  );
  ```

  ```kotlin Kotlin theme={null}
  import ai.fal.client.kt

  val fal = createFalClient()

  val input = mapOf<String, Any>(
      "prompt" to "a cat",
      "seed" to 6252023,
      "image_size" to "landscape_4_3",
      "num_images" to 4
  )

  val job = fal.queue.submit("fal-ai/flux/dev", input, options = SubmitOptions(
      webhookUrl = "https://optional.webhook.url/for/results"
  ))
  ```

  ```dart Dart (Flutter) theme={null}
  import 'package:fal_client/fal_client.dart';

  final fal = FalClient.withCredentials("FAL_KEY");

  final job = await fal.queue.submit("fal-ai/flux/dev",
    input: {
      "prompt": "a cat",
      "seed": 6252023,
      "image_size": "landscape_4_3",
      "num_images": 4
    },
    webhookUrl: "https://optional.webhook.url/for/results"
  );
  print(job.requestId);
  ```
</CodeGroup>

This is useful when you want to submit a request to the queue and retrieve the result later. You can save the `request_id` and use it to retrieve the result later.

<Note>
  **Webhooks**

  For long-running requests, such as **training jobs**, you can use webhooks to receive the result asynchronously. You can specify the webhook URL when submitting a request.
</Note>

<Note>
  **Custom Headers**

  Both `submit` and `subscribe` methods support an optional `headers` parameter that allows you to pass custom HTTP headers with your request. This can be useful for adding custom metadata, tracking information, or other request-specific headers.

  <CodeGroup>
    ```typescript TypeScript theme={null}
    headers: { "X-Custom-Header": "value", "X-Request-ID": "12345" }
    ```

    ```python Python theme={null}
    headers={"X-Custom-Header": "value", "X-Request-ID": "12345"}
    ```
  </CodeGroup>

  You can also use the `X-Fal-Object-Lifecycle-Preference` header to control how long images and other objects generated by your request remain available:

  <CodeGroup>
    ```typescript TypeScript theme={null}
    headers: { "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: 3600 }) }
    ```

    ```python Python theme={null}
    import json
    headers={"X-Fal-Object-Lifecycle-Preference": json.dumps({"expiration_duration_seconds": 3600})}
    ```
  </CodeGroup>
</Note>

#### Check Request Status

Retrieve the status of a specific request in the queue:

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const status = await fal.queue.status("fal-ai/flux/dev", {
    requestId: "764cabcf-b745-4b3e-ae38-1200304cf45b",
    logs: true,
  });
  ```

  ```python Python theme={null}
  status = fal_client.status("fal-ai/flux/dev", request_id, with_logs=True)
  ```

  ```python Python (async) theme={null}
  status = await fal_client.status_async("fal-ai/flux/dev", request_id, with_logs=True)
  ```

  ```swift Swift theme={null}
  import FalClient

  let status = try await fal.queue.status(
      "fal-ai/flux/dev",
      of: "764cabcf-b745-4b3e-ae38-1200304cf45b",
      includeLogs: true
  )
  ```

  ```java Java theme={null}
  import ai.fal.client.*;
  import ai.fal.client.queue.*;

  var fal = FalClient.withEnvCredentials();

  var job = fal.queue().status("fal-ai/flux/dev", QueueStatusOptions
      .withRequestId("764cabcf-b745-4b3e-ae38-1200304cf45b"));
  ```

  ```kotlin Kotlin theme={null}
  import ai.fal.client.kt

  val fal = createFalClient()

  val job = fal.queue.status("fal-ai/flux/dev",
      requestId = "764cabcf-b745-4b3e-ae38-1200304cf45b",
      options = StatusOptions(
          logs = true
      )
  )
  ```

  ```dart Dart (Flutter) theme={null}
  import 'package:fal_client/fal_client.dart';

  final fal = FalClient.withCredentials("FAL_KEY");

  final job = await fal.queue.status("fal-ai/flux/dev",
    requestId: "764cabcf-b745-4b3e-ae38-1200304cf45b",
    logs: true
  );

  print(job.requestId);
  print(job.status);
  ```
</CodeGroup>

#### Retrieve Request Result

Get the result of a specific request from the queue:

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const result = await fal.queue.result("fal-ai/flux/dev", {
    requestId: "764cabcf-b745-4b3e-ae38-1200304cf45b",
  });

  console.log(result.data);
  console.log(result.requestId);
  ```

  ```python Python theme={null}
  result = fal_client.result("fal-ai/flux/dev", request_id)
  ```

  ```python Python (async) theme={null}
  result = await fal_client.result_async("fal-ai/flux/dev", request_id)
  ```

  ```swift Swift theme={null}
  import FalClient

  let result = try await fal.queue.response(
      "fal-ai/flux/dev",
      of: "764cabcf-b745-4b3e-ae38-1200304cf45b"
  )
  ```

  ```java Java theme={null}
  import ai.fal.client.*;
  import ai.fal.client.queue.*;

  var fal = FalClient.withEnvCredentials();

  var result = fal.queue().result("fal-ai/flux/dev", QueueResultOptions
      .withRequestId("764cabcf-b745-4b3e-ae38-1200304cf45b"));
  ```

  ```kotlin Kotlin theme={null}
  import ai.fal.client.kt

  val fal = createFalClient()

  val result = fal.queue.result("fal-ai/flux/dev",
      requestId = "764cabcf-b745-4b3e-ae38-1200304cf45b"
  )
  ```

  ```dart Dart (Flutter) theme={null}
  import 'package:fal_client/fal_client.dart';

  final fal = FalClient.withCredentials("FAL_KEY");

  final output = await fal.queue.result("fal-ai/flux/dev",
    requestId: "764cabcf-b745-4b3e-ae38-1200304cf45b"
  );

  print(output.requestId);
  print(output.data);
  ```
</CodeGroup>

### 3. File Uploads

Some endpoints require files as input. However, since the endpoints run asynchronously, processed by the queue, you will need to provide URLs to the files instead of the actual file content.

Luckily, the client library provides a way to upload files to the server and get a URL to use in the request.

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const file = new File(["Hello, World!"], "hello.txt", { type: "text/plain" });
  const url = await fal.storage.upload(file);
  ```

  ```python Python theme={null}
  url = fal_client.upload_file("path/to/file")
  ```

  ```python Python (async) theme={null}
  url = fal_client.upload_file_async("path/to/file")
  ```

  ```swift Swift theme={null}
  import FalClient

  let data = try await Data(contentsOf: URL(fileURLWithPath: "/path/to/file"))
  let url = try await fal.storage.upload(data)
  ```

  ```java Java theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```

  ```kotlin Kotlin theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```

  ```dart Dart (Flutter) theme={null}
  import 'package:cross_file/cross_file.dart';
  import 'package:fal_client/fal_client.dart';

  final fal = FalClient.withCredentials("FAL_KEY");

  final file = XFile("path/to/file");
  final url = await fal.storage.upload(file);
  ```
</CodeGroup>

### 4. Streaming

Some endpoints support streaming:

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const stream = await fal.stream("fal-ai/flux/dev", {
    input: {
      prompt: "a cat",
      seed: 6252023,
      image_size: "landscape_4_3",
      num_images: 4,
    },
  });

  for await (const event of stream) {
    console.log(event);
  }

  const result = await stream.done();
  ```

  ```python Python theme={null}
  import fal_client

  def stream():
      stream = fal_client.stream(
          "fal-ai/flux/dev",
          arguments={
              "prompt": "a cat",
              "seed": 6252023,
              "image_size": "landscape_4_3",
              "num_images": 4
          },
      )
      for event in stream:
          print(event)


  if __name__ == "__main__":
      stream()
  ```

  ```python Python (async) theme={null}
  import asyncio
  import fal_client

  async def stream():
      stream = fal_client.stream_async(
          "fal-ai/flux/dev",
          arguments={
              "prompt": "a cat",
              "seed": 6252023,
              "image_size": "landscape_4_3",
              "num_images": 4
          },
      )
      async for event in stream:
          print(event)


  if __name__ == "__main__":
      asyncio.run(stream())
  ```

  ```swift Swift theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```

  ```java Java theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```

  ```kotlin Kotlin theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```

  ```dart Dart (Flutter) theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```
</CodeGroup>

### 5. Realtime Communication

For the endpoints that support real-time inference via WebSockets, you can use the realtime client that abstracts the WebSocket connection, re-connection, serialization, and provides a simple interface to interact with the endpoint:

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const connection = fal.realtime.connect("fal-ai/flux/dev", {
    onResult: (result) => {
      console.log(result);
    },
    onError: (error) => {
      console.error(error);
    },
  });

  connection.send({
    prompt: "a cat",
    seed: 6252023,
    image_size: "landscape_4_3",
    num_images: 4,
  });
  ```

  ```python Python theme={null}
  # Not implemented yet
  # This functionality is not available on this client yet.
  ```

  ```python Python (async) theme={null}
  # Not implemented yet
  # This functionality is not available on this client yet.
  ```

  ```swift Swift theme={null}
  import FalClient

  let connection = try fal.realtime.connect(to: "fal-ai/flux/dev") { result in
      switch result {
      case let .success(data):
          print(data)
      case let .failure(error):
          print(error)
      }
  }

  connection.send([
      "prompt": "a cat",
      "seed": 6252023,
      "image_size": "landscape_4_3",
      "num_images": 4
  ])
  ```

  ```java Java theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```

  ```kotlin Kotlin theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```

  ```dart Dart (Flutter) theme={null}
  // Not implemented yet
  // This functionality is not available on this client yet.
  ```
</CodeGroup>

### 6. Run

The endpoints can also be called directly instead of using the queue system.

<Warning>
  **Prefer the queue**

  We **do not recommend** this use most use cases as it will block the client
  until the response is received. Moreover, if the connection is closed before
  the response is received, the request will be lost.
</Warning>

<CodeGroup>
  ```javascript JavaScript/TypeScript theme={null}
  import { fal } from "@fal-ai/client";

  const result = await fal.run("fal-ai/flux/dev", {
    input: {
      prompt: "a cat",
      seed: 6252023,
      image_size: "landscape_4_3",
      num_images: 4,
    },
  });

  console.log(result.data);
  console.log(result.requestId);
  ```

  ```python Python theme={null}
  import fal_client

  result = fal_client.run(
      "fal-ai/flux/dev",
      arguments={
          "prompt": "a cat",
          "seed": 6252023,
          "image_size": "landscape_4_3",
          "num_images": 4
      },
  )

  print(result)
  ```

  ```python Python (async) theme={null}
  import asyncio
  import fal_client

  async def submit():
      result = await fal_client.run_async(
          "fal-ai/flux/dev",
          arguments={
              "prompt": "a cat",
              "seed": 6252023,
              "image_size": "landscape_4_3",
              "num_images": 4
          },
      )

      print(result)


  if __name__ == "__main__":
      asyncio.run(submit())
  ```

  ```swift Swift theme={null}
  import FalClient

  let result = try await fal.run(
      "fal-ai/flux/dev",
      input: [
          "prompt": "a cat",
          "seed": 6252023,
          "image_size": "landscape_4_3",
          "num_images": 4
      ])
  ```

  ```java Java theme={null}
  import ai.fal.client.*;

  var fal = FalClient.withEnvCredentials();

  var input = Map.of(
      "prompt", "a cat",
      "seed", 6252023,
      "image_size", "landscape_4_3",
      "num_images", 4
  );

  var result = fal.run("fal-ai/flux/dev", RunOptions.withInput(input));
  ```

  ```kotlin Kotlin theme={null}
  import ai.fal.client.kt

  val fal = createFalClient()

  val input = mapOf<String, Any>(
      "prompt" to "a cat",
      "seed" to 6252023,
      "image_size" to "landscape_4_3",
      "num_images" to 4
  )

  val result = fal.run("fal-ai/flux/dev", input)
  ```

  ```dart Dart (Flutter) theme={null}
  import 'package:fal_client/fal_client.dart';

  final fal = FalClient.withCredentials("FAL_KEY");

  final output = await fal.run("fal-ai/flux/dev",
    input: {
      "prompt": "a cat",
      "seed": 6252023,
      "image_size": "landscape_4_3",
      "num_images": 4
    });

  print(output.requestId);
  print(output.data);
  ```
</CodeGroup>

## API References

For a complete list of available methods and their parameters, please refer to the language-specific API Reference documentation:

* [JavaScript/TypeScript API Reference](https://fal-ai.github.io/fal-js/reference)
* [Python API Reference](https://fal-ai.github.io/fal/client)
* [Swift (iOS) API Reference](https://swiftpackageindex.com/fal-ai/fal-swift/documentation/falclient)
* [Java API Reference](https://fal-ai.github.io/fal-java/fal-client/index.html)
* [Kotlin API Reference](https://fal-ai.github.io/fal-java/fal-client-kotlin/fal-client-kotlin/ai.fal.client.kt/index.html)
* [Dart (Flutter) API Reference](https://pub.dev/documentation/fal_client/latest)

## Examples

Check out some of the examples below to see real-world use cases of the client libraries:

* **JavaScript**: See `fal.realtime` in action with SDXL Lightning: [https://github.com/fal-ai/sdxl-lightning-demo-app](https://github.com/fal-ai/sdxl-lightning-demo-app)
* **Dart (Flutter)**: Simple Flutter app using fal image inference: [https://pub.dev/packages/fal\_client/example](https://pub.dev/packages/fal_client/example)

## Migration Guide

### JavaScript: Migrating from `serverless-client` to `client`

As fal no longer uses "serverless" as part of the AI provider branding, we also made sure that's reflected in our libraries. However, that's not the only thing that changed in the new client. There was lot's of improvements that happened thanks to our community feedback.

So, if you were using the `@fal-ai/serverless-client` package, you can upgrade to the new `@fal-ai/client` package by following these steps:

<Steps>
  <Step>
    Remove the `@fal-ai/serverless-client` package from your project:

    ```bash  theme={null}
    npm uninstall @fal-ai/serverless-client
    ```
  </Step>

  <Step>
    Install the new `@fal-ai/client` package:

    ```bash  theme={null}
    npm install --save @fal-ai/client
    ```
  </Step>

  <Step>
    Update your imports:

    ```js  theme={null}
    import * as fal from "@fal-ai/serverless-client"; // [!code --]
    import { fal } from "@fal-ai/client"; // [!code ++]
    ```
  </Step>

  <Step>
    Now APIs return a `Result<Output>` type that contains the `data` which is the API output and the `requestId`. This is a breaking change from the previous version, that allows us to return extra data to the caller without future breaking changes.

    ```js  theme={null}
    const data = fal.subscribe(endpointId, { input }); // [!code --]
    const { data, requestId } = fal.subscribe(endpointId, { input }); // [!code ++]
    ```
  </Step>
</Steps>

<Note>
  **Note**

  The `fal` object is now a named export from the package that represents a singleton instance of the `FalClient` and was added to make it as easy as possible to migrate from the old singleton-only client. However, starting in `1.0.0` you can create multiple instances of the `FalClient` with the `createFalClient` function.
</Note>

## Support

If you encounter any issues or have questions, please:

* Visit the respective GitHub repositories:
  * [JavaScript/TypeScript](https://github.com/fal-ai/fal-js)
  * [Python](https://github.com/fal-ai/fal)
  * [Swift](https://github.com/fal-ai/fal-swift)
  * [Java/Kotlin](https://github.com/fal-ai/fal-java)
  * [Dart (Flutter)](https://github.com/fal-ai/fal-dart)
* Join our [Discord Community](https://discord.gg/fal-ai)


---

> To find navigation and other pages in this documentation, fetch the llms.txt file at: https://docs.fal.ai/llms.txt