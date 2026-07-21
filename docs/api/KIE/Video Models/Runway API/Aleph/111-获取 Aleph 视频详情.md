# 获取 Aleph 视频详情

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/aleph/record-info:
    get:
      summary: 获取 Aleph 视频详情
      deprecated: false
      description: >-
        ## 概述


        检索有关您的 Runway Alpeh 视频生成任务的详细信息，包括当前状态、生成参数、视频 URL
        和错误详情。此端点对于监控任务进度和访问已完成的视频至关重要。


        ::: note[]

        如果您不使用回调，请使用此端点轮询任务状态，或检索已完成任务的详细信息。

        :::


        ## 相关文档


        <CardGroup cols={2}>
          <Card
            title="生成 Aleph 视频"
            icon="video"
            href="/cn/runway-api/generate-aleph-video"
          >
            学习如何创建视频生成请求
          </Card>
          <Card
            title="回调集成"
            icon="webhook"
            href="/cn/runway-api/generate-aleph-video-callbacks"
          >
            实现 webhook 而不是轮询以提高效率
          </Card>
        </CardGroup>
      operationId: get-aleph-video-details
      tags:
        - docs/zh-CN/Market/Video Models/Runway API/Aleph
      parameters:
        - name: taskId
          in: query
          description: Aleph 视频生成任务的唯一标识符。这是创建 Aleph 视频时返回的 taskId。
          required: true
          example: ee603959-debb-48d1-98c4-a6d1c717eba6
          schema:
            type: string
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
                        enum:
                          - 200
                          - 401
                          - 404
                          - 422
                          - 429
                          - 451
                          - 455
                          - 500
                        description: |-
                          响应状态码

                          - **200**: 成功 - 请求已成功处理
                          - **401**: 未授权 - 身份验证凭据缺失或无效
                          - **404**: 未找到 - 请求的资源或端点不存在
                          - **422**: 验证错误 - 请求参数验证失败
                          - **429**: 速率限制 - 此资源的请求限制已超出
                          - **451**: 未授权 - 获取图像失败。请验证您或您的服务提供商设置的任何访问限制。
                          - **455**: 服务不可用 - 系统当前正在维护中
                          - **500**: 服务器错误 - 处理请求时发生意外错误
                      msg:
                        type: string
                        description: 状态消息
                        examples:
                          - success
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: Aleph AI 视频生成任务的唯一标识符
                            examples:
                              - ee603959-debb-48d1-98c4-a6d1c717eba6
                          paramJson:
                            type: string
                            description: 包含原始生成请求参数的 JSON 字符串
                            examples:
                              - >-
                                {"prompt":"一只雄鹰在山间云雾中翱翔","videoUrl":"https://example.com/input-video.mp4"}
                          response:
                            type: object
                            description: 包含生成视频信息的响应数据
                            properties:
                              taskId:
                                type: string
                                description: 与此生成关联的任务 ID
                                examples:
                                  - ee603959-debb-48d1-98c4-a6d1c717eba6
                              resultVideoUrl:
                                type: string
                                description: 访问和下载生成视频的 URL，有效期 14 天
                                examples:
                                  - https://file.com/k/xxxxxxx.mp4
                              resultImageUrl:
                                type: string
                                description: 从生成的视频中提取的缩略图 URL
                                examples:
                                  - https://file.com/m/xxxxxxxx.png
                            x-apidog-orders:
                              - taskId
                              - resultVideoUrl
                              - resultImageUrl
                            x-apidog-ignore-properties: []
                          completeTime:
                            type: string
                            format: date-time
                            description: 视频生成完成时的时间戳
                            examples:
                              - '2023-08-15T14:30:45Z'
                          createTime:
                            type: string
                            format: date-time
                            description: 任务创建时的时间戳
                            examples:
                              - '2023-08-15T14:25:00Z'
                          successFlag:
                            type: integer
                            format: int32
                            description: 成功状态：1 = 成功，0 = 失败或进行中
                            enum:
                              - 0
                              - 1
                            examples:
                              - 1
                          errorCode:
                            type: integer
                            format: int32
                            description: 生成失败时的错误码（成功时为 0）
                            examples:
                              - 0
                          errorMessage:
                            type: string
                            description: 解释失败原因的详细错误消息（成功时为空）
                            examples:
                              - ''
                        x-apidog-orders:
                          - taskId
                          - paramJson
                          - response
                          - completeTime
                          - createTime
                          - successFlag
                          - errorCode
                          - errorMessage
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - code
                      - msg
                      - data
                    x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: ee603959-debb-48d1-98c4-a6d1c717eba6
                  paramJson: >-
                    {"prompt":"一只雄鹰在夕阳下的山间云雾中翱翔","videoUrl":"https://example.com/input-video.mp4"}
                  response:
                    taskId: ee603959-debb-48d1-98c4-a6d1c717eba6
                    resultVideoUrl: https://file.com/k/xxxxxxx.mp4
                    resultImageUrl: https://file.com/m/xxxxxxxx.png
                  completeTime: '2023-08-15T14:30:45Z'
                  createTime: '2023-08-15T14:25:00Z'
                  successFlag: 1
                  errorCode: 0
                  errorMessage: ''
          headers: {}
          x-apidog-name: ''
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Runway API/Aleph
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506748-run
components:
  schemas: {}
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
