# HappyHorse 1.1 参考图生成视频

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: HappyHorse 1.1 参考图生成视频
      deprecated: false
      description: >-

        ## 查询任务状态

        任务提交后，可通过统一查询接口检查任务进度并获取生成结果：

        <Card title="获取任务详情" icon="lucide-search"
        href="/market/common/get-task-detail">
         了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        在生产环境中，建议使用 "callBackUrl" 参数在生成完成后接收自动通知，而非轮询状态接口。

        :::


        相关资源

        <CardGroup cols={2}>
          <Card title="模型市场总览" icon="lucide-store" href="/market/quickstart"> 查看所有可用模型 </Card>
          <Card title="通用 API" icon="lucide-cog" href="/common-api/get-account-credits"> 查看账户额度与使用情况 </Card>
        </CardGroup>
      operationId: playground_254
      tags:
        - docs/zh-CN/Market/Video Models/HappyHorse
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required:
                - model
                - input
              properties:
                model:
                  type: string
                  enum:
                    - happyhorse-1-1/reference-to-video
                  default: happyhorse-1-1/reference-to-video
                  description: 用于生成的模型名称。该接口必须使用 `happyhorse-1-1/reference-to-video`。
                input:
                  type: object
                  additionalProperties: false
                  description: 生成任务的输入参数。
                  properties:
                    prompt:
                      type: string
                      description: >-
                        对生成视频所需元素与视觉风格的描述。支持任意语言输入，长度限制为 5,000 个非中文字符或 2,500
                        个中文字符，超出部分将被自动截断。图片引用：在提示词中使用「[Image 1]」「[Image 2]」来引用
                        media 数组中对应的参考图，顺序需与 media
                        数组中的顺序一致。引用时请指明图片中的对象，例如「[Image 1] 中身穿红色旗袍的女子」。
                      maxLength: 5000
                      default: ''
                      examples:
                        - ''
                    reference_image:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: >-
                        参考图像的 URL。

                        图像要求：

                        1. 格式：JPEG、JPG、PNG、WEBP。

                        2. 分辨率：最短边不小于 400 像素，建议使用 720P
                        或更高分辨率的清晰图像；避免使用过小、模糊或过度压缩的图像，否则会降低输出质量。

                        3. 文件大小：不超过 20 MB。
                      maxItems: 9
                      default: []
                      examples:
                        - []
                    resolution:
                      type: string
                      enum:
                        - 720p
                        - 1080p
                      description: |-
                        生成视频的分辨率档位。
                        可选值：720p; 1080p
                      default: 1080p
                      examples:
                        - 1080p
                    aspect_ratio:
                      type: string
                      enum:
                        - '16:9'
                        - '9:16'
                        - '3:4'
                        - '4:3'
                        - '4:5'
                        - '5:4'
                        - '1:1'
                        - '9:21'
                        - '21:9'
                      description: |-
                        生成视频的宽高比。
                        可选值：16:9; 9:16; 3:4; 4:3; 4:5; 5:4; 1:1; 9:21; 21:9
                      default: '16:9'
                      examples:
                        - '16:9'
                    duration:
                      type: number
                      description: 生成视频的时长（单位：秒）。取值范围：3 到 15 之间的整数。
                      minimum: 3
                      maximum: 15
                      multipleOf: 1
                      default: 5
                      examples:
                        - 5
                  required:
                    - prompt
                    - reference_image
                  x-apidog-orders:
                    - prompt
                    - reference_image
                    - resolution
                    - aspect_ratio
                    - duration
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - input
              x-apidog-ignore-properties: []
            example:
              model: happyhorse-1-1/reference-to-video
              input:
                reference_image:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1782114387854_IufKnPxR.png
                prompt: A cat running on the grass
                resolution: 1080p
                aspect_ratio: '16:9'
                duration: 5
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties:
                      code:
                        type: integer
                        description: |-
                          响应状态码
                          200: 成功 - 请求已成功处理
                          401: 未授权 - 缺少身份验证凭据或凭据无效
                          402: 额度不足 - 账户额度不足，无法执行该操作
                          404: 未找到 - 请求的资源或接口不存在
                          422: 校验错误 - 请求参数未通过校验检查
                          429: 请求受限 - 已超过该资源的请求频率限制
                          433: 请求限额 - 子 key 使用超出限额
                          455: 服务不可用 - 系统目前正在维护中
                          500: 服务器错误 - 处理请求时发生了意外错误
                          501: 生成失败 - 内容生成任务失败
                          505: 功能禁用 - 请求的功能目前已禁用
                        enum:
                          - 200
                          - 401
                          - 402
                          - 404
                          - 422
                          - 429
                          - 433
                          - 455
                          - 500
                          - 501
                          - 505
                        x-apidog-enum:
                          - value: 200
                            name: ''
                            description: ''
                          - value: 401
                            name: ''
                            description: ''
                          - value: 402
                            name: ''
                            description: ''
                          - value: 404
                            name: ''
                            description: ''
                          - value: 422
                            name: ''
                            description: ''
                          - value: 429
                            name: ''
                            description: ''
                          - value: 433
                            name: ''
                            description: ''
                          - value: 455
                            name: ''
                            description: ''
                          - value: 500
                            name: ''
                            description: ''
                          - value: 501
                            name: ''
                            description: ''
                          - value: 505
                            name: ''
                            description: ''
                      msg:
                        type: string
                        description: 响应消息，失败时的错误描述
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
                        x-apidog-orders:
                          - taskId
                        required:
                          - taskId
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - 01KVQ5QFH6YQ0RR7J63HZPPZ3X
                    required:
                      - code
                      - msg
                      - data
                    x-apidog-refs:
                      01KVQ5QFH6YQ0RR7J63HZPPZ3X:
                        $ref: '#/components/schemas/ApiResponse'
                    x-apidog-ignore-properties:
                      - code
                      - msg
                      - data
              example:
                code: 200
                msg: success
                data:
                  taskId: task_254_abc123
          headers: {}
          x-apidog-name: ''
      security:
        - BearerAuth1: []
          x-apidog:
            schemeGroups:
              - id: coG-cD-HMGO6PBm5dJm2t
                schemeIds:
                  - BearerAuth1
            required: true
            use:
              id: coG-cD-HMGO6PBm5dJm2t
            scopes:
              coG-cD-HMGO6PBm5dJm2t:
                undefined: []
      x-apidog-folder: docs/zh-CN/Market/Video Models/HappyHorse
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-38309489-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          description: |-
            响应状态码
            200: 成功 - 请求已成功处理
            401: 未授权 - 缺少身份验证凭据或凭据无效
            402: 额度不足 - 账户额度不足，无法执行该操作
            404: 未找到 - 请求的资源或接口不存在
            422: 校验错误 - 请求参数未通过校验检查
            429: 请求受限 - 已超过该资源的请求频率限制
            433: 请求限额 - 子 key 使用超出限额
            455: 服务不可用 - 系统目前正在维护中
            500: 服务器错误 - 处理请求时发生了意外错误
            501: 生成失败 - 内容生成任务失败
            505: 功能禁用 - 请求的功能目前已禁用
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 433
            - 455
            - 500
            - 501
            - 505
          x-apidog-enum:
            - value: 200
              name: ''
              description: ''
            - value: 401
              name: ''
              description: ''
            - value: 402
              name: ''
              description: ''
            - value: 404
              name: ''
              description: ''
            - value: 422
              name: ''
              description: ''
            - value: 429
              name: ''
              description: ''
            - value: 433
              name: ''
              description: ''
            - value: 455
              name: ''
              description: ''
            - value: 500
              name: ''
              description: ''
            - value: 501
              name: ''
              description: ''
            - value: 505
              name: ''
              description: ''
        msg:
          type: string
          description: 响应消息，失败时的错误描述
        data:
          type: object
          properties:
            taskId:
              type: string
              description: 任务 ID 可与“获取任务详细信息”端点一起使用，以查询任务状态
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      required:
        - code
        - msg
        - data
      title: response not with recordId
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        All API requests require a Bearer Token. Add the header `Authorization:
        Bearer YOUR_API_KEY` to authenticate requests.
    BearerAuth1:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        所有 API 请求都需要 Bearer Token。请在请求头中添加 `Authorization: Bearer YOUR_API_KEY`
        进行身份验证。
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
