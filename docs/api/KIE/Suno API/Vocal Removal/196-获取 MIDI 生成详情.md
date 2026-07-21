# 获取 MIDI 生成详情

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/midi/record-info:
    get:
      summary: 获取 MIDI 生成详情
      deprecated: false
      description: |-
        检索 MIDI 生成任务的详细信息,包括所有检测到的乐器的完整音符数据。

        ### 使用指南
        - 使用此接口检查 MIDI 生成任务的状态
        - 处理完成后访问完整的 MIDI 音符数据
        - 检索详细的乐器和音符信息
        - 跟踪处理进度和可能发生的任何错误

        ### 状态说明
        - `successFlag: 0`: 待执行 - 任务等待执行中
        - `successFlag: 1`: 成功 - MIDI 生成成功完成
        - `successFlag: 2`: 失败 - 创建任务失败
        - `successFlag: 3`: 失败 - 生成MIDI失败
        - 查看 errorCode 和 errorMessage 字段了解失败详情

        ### 开发者注意事项
        - midiData 字段包含完整的 MIDI 数据,是包含乐器和音符的结构化对象
        - MIDI 数据包含所有检测到的乐器,每个音符都有音高、时间和力度信息
        - MIDI 生成记录保留 14 天
        - **重要提醒**: 当使用人声分离接口的 `type: split_stem` 参数时，midiData可能为空
      operationId: get-midi-details
      tags:
        - docs/zh-CN/Market/Suno API/Vocal Removal
      parameters:
        - name: taskId
          in: query
          description: MIDI 生成请求返回的任务 ID
          required: true
          example: 5c79****be8e
          schema:
            type: string
      responses:
        '200':
          description: MIDI 生成任务详情检索成功
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
                    description: MIDI 生成任务详情
                    properties:
                      taskId:
                        type: string
                        description: MIDI 生成任务 ID
                      recordTaskId:
                        type: integer
                        description: 内部记录任务 ID
                      audioId:
                        type: string
                        description: 来自人声分离任务的音频 ID
                      callbackUrl:
                        type: string
                        description: 创建任务时提供的回调 URL
                      completeTime:
                        type: integer
                        description: 任务完成时间戳(毫秒)
                      midiData:
                        type: object
                        description: 包含检测到的乐器和音符的完整 MIDI 数据
                        properties:
                          state:
                            type: string
                            description: 处理状态
                            examples:
                              - complete
                          instruments:
                            type: array
                            description: 检测到的乐器及其 MIDI 音符数组
                            items:
                              type: object
                              properties:
                                name:
                                  type: string
                                  description: 乐器名称
                                notes:
                                  type: array
                                  description: 该乐器的 MIDI 音符数组
                                  items:
                                    type: object
                                    properties:
                                      pitch:
                                        type: integer
                                        description: MIDI 音符编号 (0-127)
                                      start:
                                        type: number
                                        description: 音符起始时间(秒)
                                      end:
                                        type: number
                                        description: 音符结束时间(秒)
                                      velocity:
                                        type: number
                                        description: 音符力度/强度 (0-1)
                                    x-apidog-orders:
                                      - pitch
                                      - start
                                      - end
                                      - velocity
                                    x-apidog-ignore-properties: []
                              x-apidog-orders:
                                - name
                                - notes
                              x-apidog-ignore-properties: []
                        x-apidog-orders:
                          - state
                          - instruments
                        x-apidog-ignore-properties: []
                      successFlag:
                        type: integer
                        description: 任务状态标志:0 = 待执行,1 = 成功,2 = 创建任务失败,3 = 生成MIDI失败
                      createTime:
                        type: integer
                        description: 任务创建时间戳(毫秒)
                      errorCode:
                        type: string
                        description: 任务失败时的错误代码
                        nullable: true
                      errorMessage:
                        type: string
                        description: 任务失败时的错误消息
                        nullable: true
                    x-apidog-orders:
                      - taskId
                      - recordTaskId
                      - audioId
                      - callbackUrl
                      - completeTime
                      - midiData
                      - successFlag
                      - createTime
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
                  taskId: 5c79****be8e
                  recordTaskId: -1
                  audioId: e231****-****-****-****-****8cadc7dc
                  callbackUrl: https://example.callback
                  completeTime: 1760335255000
                  midiData:
                    state: complete
                    instruments:
                      - name: Drums
                        notes:
                          - pitch: 73
                            start: 0.036458333333333336
                            end: 0.18229166666666666
                            velocity: 1
                          - pitch: 61
                            start: 0.046875
                            end: 0.19270833333333334
                            velocity: 1
                      - name: Electric Bass (finger)
                        notes:
                          - pitch: 44
                            start: 7.6875
                            end: 7.911458333333333
                            velocity: 1
                  successFlag: 1
                  createTime: 1760335251000
                  errorCode: null
                  errorMessage: null
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
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506734-run
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
