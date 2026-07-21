# 从音频生成 MIDI

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/midi/generate:
    post:
      summary: 从音频生成 MIDI
      deprecated: false
      description: >-
        将分离后的音轨转换为 MIDI 格式，为每个乐器提供详细的音符信息。


        ## 使用指南


        * 将分离后的音轨转换为包含音高、时间和力度信息的结构化 MIDI 数据

        * 需要已完成的人声分离任务 ID（来自人声分离 API）

        * 为检测到的多个乐器生成 MIDI 音符数据，包括鼓、贝斯、吉他、键盘等

        * 适用于音乐转谱、记谱、混音或教育分析

        * 在清晰、分离良好且乐器部分明确的音轨上效果最佳


        ## 前置条件


        :::warning 必须先完成人声分离

        您必须首先使用 [人声与乐器分离](/cn/suno-api/separate-vocals) API，然后才能生成 MIDI。

        :::


        ## 参数说明


        | 参数名称 | 类型 | 是否必需 | 说明 |

        | :--- | :--- | :--- | :--- |

        | `taskId` | `string` | **必填** | 已完成的人声分离任务 ID |

        | `callBackUrl` | `string` | **必填** | 接收 MIDI 生成完成通知的回调 URL |

        | `audioId` | `string` | **可选** | 指定要生成 MIDI 的分离音频轨道。此 `audioId`
        可从[获取人声分离详情](/cn/suno-api/get-vocal-separation-details)接口的 `originData`
        数组中获取。`originData` 数组中的每个项目都包含一个 `id` 字段，可在此处使用。如果不提供，将从所有分离的轨道生成 MIDI。
        |


        ## 开发者注意事项


        * 回调将包含每个检测到的乐器的详细音符数据

        * 每个音符包含：`pitch`（MIDI 音符编号）、`start`（秒）、`end`（秒）、`velocity`（0-1）

        * 不是所有乐器都会被检测到 - 取决于音频内容

        * **计费说明**：请在 [**https://kie.ai/pricing**](https://kie.ai/pricing)
        查看当前每次调用的积分消耗
      operationId: generate-midi
      tags:
        - docs/zh-CN/Market/Suno API/Vocal Removal
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - taskId
                - callBackUrl
              properties:
                taskId:
                  type: string
                  description: 已完成的人声分离任务 ID。这应该是从人声与乐器分离端点返回的 taskId。
                  examples:
                    - 5c79****be8e
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    接收 MIDI 生成任务完成更新的 URL 地址。所有 MIDI 生成请求都需要此参数。


                    - 系统将在 MIDI 生成完成时向此 URL 发送 POST 请求,包含任务状态和 MIDI 音符数据

                    - 回调包含每个检测到的乐器的详细音符信息,包括音高、时间和力度

                    - 您的回调端点应能接受包含 MIDI 数据的 JSON 载荷的 POST 请求

                    - 详细的回调格式和实现指南,请参见 [MIDI
                    生成回调](/cn/suno-api/generate-midi-callbacks)

                    - 或者,您也可以使用获取 MIDI 生成详情接口来轮询任务状态

                    - 为确保回调安全性，请参阅 [Webhook
                    校验指南](/cn/common-api/webhook-verification) 了解签名验证实现方法
                  examples:
                    - https://example.callback
                audioId:
                  type: string
                  description: >-
                    可选。指定要生成 MIDI 的分离音频轨道。此 audioId 可从获取人声分离详情接口的 `originData`
                    数组中获取。`originData` 数组中的每个项目都包含一个 `id`
                    字段，可在此处使用。如果不提供，将从所有分离的轨道生成 MIDI。
                  examples:
                    - 8ca376e7-******-08aaf2c6dd27
              x-apidog-orders:
                - taskId
                - callBackUrl
                - audioId
              x-apidog-ignore-properties: []
            example:
              taskId: 5c79****be8e
              callBackUrl: https://example.callback
              audioId: 8ca376e7-******-08aaf2c6dd27
      responses:
        '200':
          description: MIDI 生成任务创建成功
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: 响应状态码
                    examples:
                      - 200
                  msg:
                    type: string
                    description: 响应消息
                    examples:
                      - success
                  data:
                    type: object
                    description: 包含任务信息的响应数据
                    properties:
                      taskId:
                        type: string
                        description: MIDI 生成任务的唯一标识符。使用此 ID 查询任务状态或接收回调结果。
                        examples:
                          - 5c79****be8e
                    x-apidog-orders:
                      - taskId
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
                  taskId: 5c79****be8e
          headers: {}
          x-apidog-name: ''
        '500':
          description: 请求失败
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apidog-orders: []
                x-apidog-ignore-properties: []
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
      x-apidog-folder: docs/zh-CN/Market/Suno API/Vocal Removal
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506733-run
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
