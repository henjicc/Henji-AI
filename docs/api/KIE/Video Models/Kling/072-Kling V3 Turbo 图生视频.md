# Kling V3 Turbo 图生视频

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
      summary: Kling V3 Turbo 图生视频
      deprecated: false
      description: >-
        ## 查询任务状态


        提交任务后，可通过统一的查询端点查看任务进度并获取生成结果：


        <Card title="Get Task Details" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态端点。

        :::


        ## 相关资源


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="store" href="/cn/market/quickstart">
            浏览所有可用模型
          </Card>
          <Card title="Common API" icon="gear" href="/cn/common-api/get-account-credits">
            查看账户积分与使用情况
          </Card>
        </CardGroup>
      operationId: kling-v3-turbo-image-to-video
      tags:
        - docs/zh-CN/Market/Video Models/Kling
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
                - input
              properties:
                model:
                  type: string
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该端点必须使用 `kling/v3-turbo-image-to-video` 模型
                  enum:
                    - kling/v3-turbo-image-to-video
                  default: kling/v3-turbo-image-to-video
                  x-apidog-enum:
                    - value: kling/v3-turbo-image-to-video
                      name: ''
                      description: ''
                  examples:
                    - kling/v3-turbo-image-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: |-
                    接收生成任务完成通知的回调 URL。可选配置，建议在生产环境中使用。

                    - 任务生成完成后，系统会向该 URL POST 任务状态与结果
                    - 回调内容包含生成视频的 URL 与任务相关信息
                    - 您的回调端点需要支持接收带 JSON 负载的 POST 请求
                    - 也可以选择调用任务详情端点，主动轮询任务状态
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      type: string
                      description: 视频生成的文本描述（最大长度：2500 字符）
                      maxLength: 2500
                      examples:
                        - >-
                          欧洲别墅的户外露台，一张蓝色与白色格纹桌布的餐桌旁，一位身穿蓝白条纹短袖衬衫和卡其色短裤、系着棕色腰带的年轻白人女子赤脚而坐，正对着穿着白色T恤的年轻男子。镜头拉近，女子将果汁在玻璃杯中搅动，目光望向远处的树林，说道：“这些树一个月后就会变黄，对吧？”男子低头回答：“但明年夏天它们又会变绿。”女子转过头，微笑着看向对面的男子，问道：“你总是这么乐观吗？还是只是夏天时才这样？”男子抬起头，看着女子，说：“只有和你在一起的夏天才会这样。”
                    image_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: >-
                        用于生成视频的图像 URL（为上传后的文件
                        URL，非文件内容；支持的类型：image/jpeg、image/png；最大文件大小：10.0MB）
                      examples:
                        - - >-
                            https://static.aiquickdraw.com/tools/example/1770688028208_jxcvxCQm.png
                    duration:
                      type: string
                      description: |-
                        生成视频的时长（单位：秒）
                        可选时长 3s - 15s
                      default: '5'
                      examples:
                        - '5'
                    resolution:
                      type: string
                      description: 生成视频的分辨率（720p或1080p）。默认值："720p"
                      enum:
                        - 720p
                        - 1080p
                      x-apidog-enum:
                        - value: 720p
                          name: ''
                          description: ''
                        - value: 1080p
                          name: ''
                          description: ''
                      default: 720p
                      examples:
                        - 720p
                  required:
                    - prompt
                    - image_urls
                    - duration
                    - resolution
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - duration
                    - resolution
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling/v3-turbo-image-to-video
              input:
                image_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1770688028208_jxcvxCQm.png
                prompt: >-
                  欧洲别墅的户外露台，一张蓝色与白色格纹桌布的餐桌旁，一位身穿蓝白条纹短袖衬衫和卡其色短裤、系着棕色腰带的年轻白人女子赤脚而坐，正对着穿着白色T恤的年轻男子。镜头拉近，女子将果汁在玻璃杯中搅动，目光望向远处的树林，说道：“这些树一个月后就会变黄，对吧？”男子低头回答：“但明年夏天它们又会变绿。”女子转过头，微笑着看向对面的男子，问道：“你总是这么乐观吗？还是只是夏天时才这样？”男子抬起头，看着女子，说：“只有和你在一起的夏天才会这样。”
                duration: '5'
                resolution: 720p
      responses:
        '200':
          description: 请求成功
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_kling_1765184408908
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Kling
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-38104642-run
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
