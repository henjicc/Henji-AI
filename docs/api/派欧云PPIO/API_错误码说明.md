
# API 错误码说明

## 图片 / 视频 / 音频

| 错误名称                 | 状态码 | 说明                     |
|--------------------------|--------|--------------------------|
| INVALID_REQUEST_BODY     | 400    | 请求参数校验失败         |
| IMAGE_FILE_EXCEEDS_MAX_SIZE | 400 | 图片大小超出限制       |
| INVALID_IMAGE_FORMAT     | 400    | 图片格式与要求不符       |
| IMAGE_EXCEEDS_MAX_RESOLUTION | 400 | 图片分辨率超出限制     |
| INVALID_IMAGE_SIZE       | 400    | 图片长或宽超出限制       |
| API_NOT_FOUND            | 404    | API 不存在               |
| IMAGE_NO_FACE_DETECTED   | 400    | 未检测到人脸             |
| INVALID_CUSTOM_OUTPUT_PATH | 400 | OSS 路径不合法         |
| ILLEGAL_PROMPT           | 400    | Prompt 含不适宜内容       |
| ILLEGAL_IMAGE_CONTENT    | 400    | 图片含不适宜内容         |
| INVALID_AUDIO_FILE       | 400    | 输入音频不合法           |
| BILLING_FAILED           | 500    | 计费服务异常             |
| BILLING_AUTH_FAILED      | 403    | 计费服务鉴权失败         |
| BILLING_BALANCE_NOT_ENOUGH | 400  | 余额不足                 |
| MISSING_API_KEY          | 400    | 未提供 API Key           |
| INVALID_API_KEY          | 403    | API Key 校验失败         |
| FEATURE_NOT_ALLOWED      | 403    | 没有模型上传权限         |
| API_NOT_ALLOWED          | 403    | 无权限使用该 API         |
| RATE_LIMIT_EXCEEDED      | 429    | 触发频率控制限制         |
| NEED_REAL_NAME_VERIFY    | 403    | 未完成企业认证           |
| CREATE_TASK_FAILED       | 500    | 创建任务失败             |
| TASK_NOT_FOUND           | 404    | 任务不存在               |
| GET_RESULT_FAILED        | 500    | 获取任务结果失败         |
| TASK_FAILED              | 500    | 任务执行失败             |

## 大语言

| 错误名称                 | 状态码 | 说明                     |
|--------------------------|--------|--------------------------|
| INVALID_API_KEY          | 403    | 未提供 API Key           |
| MODEL_NOT_FOUND          | 404    | 模型不存在               |
| FAILED_TO_AUTH           | 401    | 认证失败                 |
| NOT_ENOUGH_BALANCE       | 403    | 余额不足                 |
| INVALID_REQUEST_BODY     | 400    | 请求体格式错误，详见 message |
| RATE_LIMIT_EXCEEDED      | 429    | 请求过快，请稍后重试     |
| TOKEN_LIMIT_EXCEEDED     | 429    | Token 数超限，请稍后重试 |
| SERVICE_NOT_AVAILABLE    | 503    | 服务不可用               |
| ACCESS_DENY              | 403    | 无权限访问               |

## 账单

| 错误名称                 | 状态码 | 说明                     |
|--------------------------|--------|--------------------------|
| UNKNOWN                  | 500    | 未知错误，请联系我们     |
| LIST_BILL_TOO_FAST       | 429    | 请求过于频繁，请稍后重试 |
| INVALID_PRODUCT_CATEGORY | 400    | productCategory 参数错误 |
| INVALID_BILL_CYCLE       | 400    | cycle 参数错误           |
| LIST_BILL_ERROR          | 500    | 查询错误，请联系我们     |
