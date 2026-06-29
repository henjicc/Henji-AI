# Hailuo Standard 图生视频

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
      summary: Hailuo Standard 图生视频
      deprecated: false
      description: >-
        ## 查询任务状态


        提交任务后，可通过统一的查询接口查看任务进度并获取结果：


        <Card title="Get Task Details" icon="magnifying-glass"
        href="/cn/market/common/get-task-detail">
          了解如何查询任务状态并获取生成结果
        </Card>


        ::: tip[]

        生产环境中，建议使用 `callBackUrl` 参数接收生成完成的自动通知，而非轮询状态接口。

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
      operationId: hailuo-02-image-to-video-standard
      tags:
        - docs/zh-CN/Market/Video Models/Hailuo
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - hailuo/02-image-to-video-standard
                  default: hailuo/02-image-to-video-standard
                  description: |-
                    用于生成任务的模型名称。必填字段。

                    - 该接口必须使用 `hailuo/02-image-to-video-standard` 模型
                  examples:
                    - hailuo/02-image-to-video-standard
                callBackUrl:
                  type: string
                  format: uri
                  description: |-
                    接收生成任务完成通知的回调 URL。可选配置，生产环境建议使用。

                    - 任务生成完成后，系统会向该 URL 以 POST 方式推送任务状态和结果
                    - 回调内容包含生成内容的 URL 及任务相关信息
                    - 你的回调接口需支持接收 POST 请求及 JSON 格式的请求体
                    - 也可选择调用任务详情接口，主动轮询任务状态
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: 生成任务的输入参数
                  properties:
                    prompt:
                      description: 描述待生成视频效果的文本提示词（最大长度：1500 字符）
                      type: string
                      maxLength: 1500
                      examples:
                        - >-
                          史诗级航拍镜头：一名孤独的武士伫立在嶙峋的山峰之巅，漫天樱花花瓣随风狂舞。他身后的天空一分为二——一半白昼，一半黑夜。镜头缓缓拉远，露出这座山峰实则是沉睡巨龙蜿蜒的脊背，巨龙的身躯横跨整个地平线。远处电光闪烁，巨龙的眼眸缓缓睁开，散发着古老魔法的光芒。武士面不改色，缓缓压低斗笠，手按在了刀柄之上。
                    image_url:
                      description: >-
                        作为视频第一帧的图像 URL（需为上传后的文件
                        URL，而非文件内容；支持的格式：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/17585207681646umf3lz8.png
                    end_image_url:
                      description: >-
                        可选参数，作为视频最后一帧的图像 URL（需为上传后的文件
                        URL，而非文件内容；支持的格式：image/jpeg、image/png、image/webp；最大文件大小：10.0MB）
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1758521423357w8586uq8.png
                    duration:
                      description: >-
                        视频时长（单位：秒）。1080p 分辨率不支持生成 10 秒时长的视频（注：本模型枚举值无
                        1080p，此处为通用约束说明）
                      type: string
                      enum:
                        - '6'
                        - '10'
                      default: '10'
                      examples:
                        - '10'
                    resolution:
                      description: 生成视频的分辨率
                      type: string
                      enum:
                        - 512P
                        - 768P
                      default: 768P
                      examples:
                        - 768P
                    prompt_optimizer:
                      description: 是否启用模型的提示词优化功能（布尔值：true/false）
                      type: boolean
                      examples:
                        - true
                    nsfw_checker:
                      type: boolean
                      default: false
                      description: >-
                        默认值为 false。您可以根据需要将其设置为 false。如果设置为
                        false，我们的内容过滤功能将被禁用，所有结果将由模型直接返回。
                  required:
                    - prompt
                    - image_url
                  x-apidog-orders:
                    - prompt
                    - image_url
                    - end_image_url
                    - duration
                    - resolution
                    - prompt_optimizer
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: hailuo/02-image-to-video-standard
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  史诗级航拍镜头：一名孤独的武士伫立在嶙峋的山峰之巅，漫天樱花花瓣随风狂舞。他身后的天空一分为二——一半白昼，一半黑夜。镜头缓缓拉远，露出这座山峰实则是沉睡巨龙蜿蜒的脊背，巨龙的身躯横跨整个地平线。远处电光闪烁，巨龙的眼眸缓缓睁开，散发着古老魔法的光芒。武士面不改色，缓缓压低斗笠，手按在了刀柄之上。
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/17585207681646umf3lz8.png
                end_image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1758521423357w8586uq8.png
                duration: '10'
                resolution: 768P
                prompt_optimizer: true
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
                  taskId: task_hailuo_1765185334551
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
      x-apidog-folder: docs/zh-CN/Market/Video Models/Hailuo
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506681-run
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
