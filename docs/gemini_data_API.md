# Gemini Enterprise API 規範文件

- **API 版本 (Version)**: `1.0.0`
- **OpenAPI 規範**: `OAS 3.0`
- **Base Server**: `/`

---

# 模組分類：專案管理 (portal/projects)

## `GET` /api/v1/portal/projects/{id}/status
**摘要**: Get project status (provisioning state)

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |

### 回應 (Responses)
- **`200`** - Project status
- ---

---

## `GET` /api/v1/portal/projects/{id}/messageCount
**摘要**: Get project message count by year/month

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |

### 回應 (Responses)
- **`200`** - Message count by date
- ---

---

## `GET` /api/v1/portal/projects/{id}
**摘要**: Get project details

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |
| `withMeta` | `boolean` | `query` | 選填 |  |
| `skipCache` | `boolean` | `query` | 選填 |  |

### 回應 (Responses)
- **`200`** - Project object
- ---

---

## `POST` /api/v1/portal/projects/{id}
**摘要**: Edit a project

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |

---

## `POST` /api/v1/portal/projects/{id}/cleanup
**摘要**: Cleanup project data (owner admin)

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |

### 回應 (Responses)
- **`200`** - Project cleaned up
- ---

---

## `POST` /api/v1/portal/projects/{id}/reset
**摘要**: Reset project (admin only)

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |

### 回應 (Responses)
- **`200`** - Project reset
- ---

---

## `POST` /api/v1/portal/projects/{id}/inviteUser
**摘要**: Invite a user to a project

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |

---

## `POST` /api/v1/portal/projects/{id}/removeUser
**摘要**: Remove a user from a project

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `id` | `string` | `path` | 必填 |  |

---

# 模組分類：對話與分析 (chat/chat)

## `GET` /api/v1/chat/summary
**摘要**: Get chat summary

Retrieves a summary of the chat based on the specified type.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `type` | `string` | `query` | 選填 | The type of summary to retrieve (default, markdown, literal). |

### 回應 (Responses)
- **`200`**: Summary retrieved successfully.

---

## `GET` /api/v1/chat/list
**摘要**: List chats

Retrieves a list of chats based on the user's permissions and query parameters.

---

## `GET` /api/v1/chat/{chat_id}/messages
**摘要**: Get chat messages

Retrieves messages for a specific chat.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |

### 回應 (Responses)
- **`200`**: Messages retrieved successfully.

---

## `GET` /api/v1/chat/{chat_id}
**摘要**: Get chat details

Retrieves details of a specific chat.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |

### 回應 (Responses)
- **`200`**: Chat details retrieved successfully.

---

## `POST` /api/v1/chat/{chat_id}
**摘要**: Ask a question in a chat

Sends a question to a specific chat and retrieves the AI's response. Supports streaming responses.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |
| `chat_id` | `Request body` | `` | 選填 |  |

---

## `POST` /api/v1/chat/create
**摘要**: Create a new chat

Creates a new chat with the provided details.

## 模組: `application/json`

---

## `POST` /api/v1/chat/{chat_id}/update
**摘要**: Update chat details

Updates the details of a specific chat.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |
| `chat_id` | `Request body` | `` | 選填 |  |

---

## `POST` /api/v1/chat/{chat_id}/{message_id}/chartgen
**摘要**: Generate a chart for a specific message

Generates a chart based on the data of a specific message in a chat.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |
| `chat_id` | `message_id *` | `` | 選填 |  |
| `string` | `(path)` | `` | 選填 | The ID of the message. |
| `message_id` | `Request body` | `` | 選填 |  |

---

## `POST` /api/v1/chat/{chat_id}/{message_id}/update
**摘要**: Update a specific message in a chat

Updates the content of a specific message in a chat by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |
| `chat_id` | `message_id *` | `` | 選填 |  |
| `string` | `(path)` | `` | 選填 | The ID of the message to update. |
| `message_id` | `Request body` | `` | 選填 |  |

---

## `POST` /api/v1/chat/{chat_id}/remove
**摘要**: Remove chat

Deletes a specific chat.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |

### 回應 (Responses)
- **`200`**: Chat removed successfully.

---

## `GET` /api/v1/chat/{chat_id}/{message_id}/validation
**摘要**: Get validation data for a message

Retrieves validation data (graph and documents) for a specific message in a chat.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `chat_id` | `string` | `path` | 必填 | The ID of the chat. |
| `chat_id` | `messageId *` | `` | 選填 |  |
| `string` | `(path)` | `` | 選填 | The ID of the message. |

### 回應 (Responses)
- **`200`**: Validation data retrieved successfully.

---

## `GET` /api/v1/chat/document/{knowledge_id}
**摘要**: Get document from knowledge service

Retrieves a document from the knowledge service by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `knowledge_id` | `string` | `path` | 必填 | The ID of the knowledge document. |

### 回應 (Responses)
- **`200`**: Document retrieved successfully.

---

# 模組分類：問答服務 (chat/question)

## `POST` /api/v1/chat/question/{question_id}/update
**摘要**: Update question details

Updates the details of a specific question.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `question_id` | `string` | `path` | 必填 | The ID of the question. |
| `question_id` | `Request body` | `` | 選填 |  |

---

## `GET` /api/v1/chat/question/list
**摘要**: List questions

Retrieves a list of questions based on the user's permissions and query parameters.

---

## `GET` /api/v1/chat/question/categories
**摘要**: Retrieve question categories

Fetches a list of available question categories.

## 模組: `application/json`

---

## `GET` /api/v1/chat/question/{question_id}
**摘要**: Get question details

Retrieves details of a specific question.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `question_id` | `string` | `path` | 必填 | The ID of the question. |

### 回應 (Responses)
- **`200`**: Question details retrieved successfully.

---

## `POST` /api/v1/chat/question/create
**摘要**: Create a new question

Creates a new question with the provided details.

## 模組: `application/json`

---

## `POST` /api/v1/chat/question/{question_id}/remove
**摘要**: Remove question

Deletes a specific question.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `question_id` | `string` | `path` | 必填 | The ID of the question. |

### 回應 (Responses)
- **`200`**: Question removed successfully.

---

# 模組分類：訊息服務 (chat/message)

## `GET` /api/v1/chat/message/{message_id}
**摘要**: Get message details

Retrieves details of a specific message.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `message_id` | `string` | `path` | 必填 | The ID of the message. |

### 回應 (Responses)
- **`200`**: Message details retrieved successfully.

---

# 模組分類：資料匯入 - 指令管理 (import/commands)

## `GET` /api/v1/import/commands
**摘要**: Get a list of commands.

Retrieves a list of commands. Supports filtering by type and options for flat or read-only views.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `type` | `string` | `query` | 選填 | Filter commands by type. |
| `type` | `flat` | `` | 選填 |  |
| `boolean` | `(query)` | `` | 選填 | Whether to return a flat list of commands. |
| `read_only` | `boolean` | `query` | 選填 | Whether to return read-only commands. |

### 回應 (Responses)
- **`200`** - A list of commands.
- ---

---

## `PUT` /api/v1/import/commands
**摘要**: Create a new command.

Creates a new command with the provided details. Requires a valid license and appropriate access permissions.

## 模組: `application/json`

## 模組: `application/json`

---

## `GET` /api/v1/import/commands/{commandId}
**摘要**: Get a command by ID.

Retrieves the details of a specific command by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `commandId` | `string` | `path` | 必填 | The ID of the command to retrieve. |
| `Media type` | `` | `` | 選填 |  |

### 回應 (Responses)
- **`200`**: Command details retrieved successfully.

---

## `POST` /api/v1/import/commands/{commandId}
**摘要**: Update a command.

Updates the details of an existing command by its ID. Requires a valid license and appropriate access permissions.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `commandId` | `string` | `path` | 必填 | The ID of the command to update. |
| `commandId` | `Request body` | `` | 選填 |  |

---

## `DELETE` /api/v1/import/commands/{commandId}
**摘要**: Delete a command.

Deletes a specific command by its ID. Requires a valid license and appropriate access permissions.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `commandId` | `string` | `path` | 必填 | The ID of the command to delete. |

### 回應 (Responses)
- **`200`**: Command deleted successfully.

---

# 模組分類：資料匯入 - 流程管理 (import/flows)

## `GET` /api/v1/import/flows
**摘要**: Get a list of flows.

Retrieve a list of flows with optional query parameters for flat, extended, and read-only views.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flat` | `boolean` | `query` | 選填 | Whether to return a flat list of flows. |
| `extended` | `boolean` | `query` | 選填 | Whether to include extended information about flows. |
| `read_only` | `boolean` | `query` | 選填 | Whether to return flows in read-only mode. |

### 回應 (Responses)
- **`200`** - A list of flows.
- ---

---

## `PUT` /api/v1/import/flows
**摘要**: Create a new flow.

Create a new flow with the provided details.

## 模組: `application/json`

---

## `GET` /api/v1/import/flows/{flowId}
**摘要**: Get a flow by ID.

Retrieve details of a specific flow by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flowId` | `string` | `path` | 必填 | The ID of the flow to retrieve. |
| `Media type` | `` | `` | 選填 |  |

### 回應 (Responses)
- **`200`**: Flow details.

---

## `POST` /api/v1/import/flows/{flowId}
**摘要**: Update a flow.

Update details of a specific flow by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flowId` | `string` | `path` | 必填 | The ID of the flow to update. |
| `flowId` | `Request body` | `` | 選填 |  |

---

## `DELETE` /api/v1/import/flows/{flowId}
**摘要**: Delete a flow.

Delete a specific flow by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flowId` | `string` | `path` | 必填 | The ID of the flow to delete. |

### 回應 (Responses)
- **`200`**: Flow deleted successfully.

---

## `POST` /api/v1/import/flows/{flowId}/start
**摘要**: Start a flow.

Start a specific flow by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flowId` | `string` | `path` | 必填 | The ID of the flow to start. |

### 回應 (Responses)
- **`200`**: Flow started successfully.

---

## `POST` /api/v1/import/flows/{flowId}/stop
**摘要**: Stop a flow.

Stop a specific flow by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flowId` | `string` | `path` | 必填 | The ID of the flow to stop. |
| `flowId` | `Request body` | `` | 選填 |  |

---

## `GET` /api/v1/import/flows/{flowId}/status
**摘要**: Get the status of a flow.

Retrieve the current status of a specific flow by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flowId` | `string` | `path` | 必填 | The ID of the flow to retrieve the status for. |

### 回應 (Responses)
- **`200`**: Flow status retrieved successfully.

---

# 模組分類：資料匯入 - 模型管理 (import/models)

## `GET` /api/v1/import/models
**摘要**: Get models listing

Retrieve a list of all models with optional parsing, flattening, and read-only filters.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `parse` | `boolean` | `query` | 選填 | Whether to parse the models. |
| `flat` | `boolean` | `query` | 選填 | Whether to flatten the models. |
| `read_only` | `boolean` | `query` | 選填 | Whether to retrieve models in read-only mode. |

### 回應 (Responses)
- **`200`** - A list of models.
- ---

---

## `PUT` /api/v1/import/models
**摘要**: Create a model

Create a new model with the provided data.

## 模組: `application/json`

---

## `GET` /api/v1/import/models/{modelId}
**摘要**: Get a model by ID

Retrieve a specific model by its ID with optional parsing.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `modelId` | `string` | `path` | 必填 | The ID of the model to retrieve. |
| `modelId` | `parse` | `` | 選填 |  |
| `boolean` | `(query)` | `` | 選填 | Whether to parse the model. |

### 回應 (Responses)
- **`200`** - The requested model.
- ---

---

## `POST` /api/v1/import/models/{modelId}
**摘要**: Update a model

Update an existing model by its ID with the provided data.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `modelId` | `string` | `path` | 必填 | The ID of the model to update. |
| `modelId` | `Request body` | `` | 選填 |  |

---

## `DELETE` /api/v1/import/models/{modelId}
**摘要**: Delete a model

Delete a specific model by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `modelId` | `string` | `path` | 必填 | The ID of the model to delete. |

### 回應 (Responses)
- **`200`**: Model deleted successfully.

---

## `POST` /api/v1/import/models/parse
**摘要**: Get mapping preview

Parse and retrieve a mapping preview based on the provided mapping data.

## 模組: `application/json`

---

## `GET` /api/v1/import/models/{modelId}/mapping
**摘要**: Get a model's mapping

Retrieve the mapping of a specific model by its ID with optional parsing.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `modelId` | `string` | `path` | 必填 | The ID of the model to retrieve the mapping for. |
| `modelId` | `parse` | `` | 選填 |  |
| `boolean` | `(query)` | `` | 選填 | Whether to parse the mapping. |

### 回應 (Responses)
- **`200`** - The model's mapping.
- **`400`** - Bad request.
- **`404`** - Mapping not found.
- ---

---

# 模組分類：資料匯入 - 資料源管理 (import/sources)

## `GET` /api/v1/import/sources
**摘要**: Get sources listing

Retrieve a list of sources. Optionally filter by type or flatten the response.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `flat` | `boolean` | `query` | 選填 | Whether to flatten the response. |
| `read_only` | `boolean` | `query` | 選填 | Whether to retrieve read-only sources. |
| `type` | `string` | `query` | 選填 | Filter sources by type. |
| `Media type` | `` | `` | 選填 |  |

### 回應 (Responses)
- **`200`**: When flat is true, returns a flat list of sources. Otherwise, returns a dictionary of sources.

---

## `PUT` /api/v1/import/sources
**摘要**: Create a source

Create a new source with optional file upload.

## 模組: `application/json`

---

## `GET` /api/v1/import/sources/{sourceId}
**摘要**: Get source by ID

Retrieve a source by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `sourceId` | `string` | `path` | 必填 | The ID of the source. |

### 回應 (Responses)
- **`200`**: The source object.

---

## `POST` /api/v1/import/sources/{sourceId}
**摘要**: Update a source

Update an existing source by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `sourceId` | `string` | `path` | 必填 | The ID of the source. |
| `sourceId` | `Request body` | `` | 選填 |  |

---

## `DELETE` /api/v1/import/sources/{sourceId}
**摘要**: Delete a source

Delete a source by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `sourceId` | `string` | `path` | 必填 | The ID of the source. |

### 回應 (Responses)
- **`200`**: Source deleted successfully.

---

## `GET` /api/v1/import/sources/{sourceId}/download
**摘要**: Download source file by ID

Download the file associated with a source by its ID.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `sourceId` | `string` | `path` | 必填 | The ID of the source. |

### 回應 (Responses)
- **`200`**: File download initiated.

---

## `GET` /api/v1/import/sources/{sourceId}/getDownloadUrl
**摘要**: Get source download URL (SaaS mode only)

Retrieve a signed URL for downloading the file associated with a source.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `sourceId` | `string` | `path` | 必填 | The ID of the source. |

### 回應 (Responses)
- **`200`**: The signed download URL.

---

# 模組分類：資料匯入 - 檔案上傳 (import/uploads)

## `POST` /api/v1/import/uploads
**摘要**: Upload a CSV file (On-premise mode only)

Endpoint to upload a CSV file. The file must be provided in the files.file field of the request.

## 模組: `multipart/form-data`

## 模組: `application/json`

## 模組: `text/plain`

---

## `POST` /api/v1/import/uploads/signed-url
**摘要**: Get a signed URL for uploading (SaaS mode only)

Generates a signed URL for the frontend to upload a file directly to the storage provider.

## 模組: `application/json`

## 模組: `text/plain`

## 模組: `import/vector`

---

# 模組分類：向量知識庫服務 (import/vector)

## `GET` /api/v1/import/vector/knowledge
**摘要**: List knowledge items from the Vector service.

This endpoint retrieves a list of knowledge items from the Vector service. It requires the user to have the source:read access permission.

## 模組: `application/json`

## 模組: `text/plain`

## 模組: `text/plain`

## 模組: `text/plain`

---

## `POST` /api/v1/import/vector/knowledge
**摘要**: Create knowledge items in the Vector service.

Creates knowledge items using the provided category/label and a list of files. Requires the user to have the source:write access permission.

## 模組: `multipart/form-data`

## 模組: `text/plain`

## 模組: `text/plain`

## 模組: `text/plain`

---

## `GET` /api/v1/import/vector/knowledge/{knowledge_id}
**摘要**: Retrieve knowledge content from the Vector service.

This endpoint retrieves the content of a specific knowledge item from the Vector service. It requires the user to have the source:read access permission.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `knowledge_id` | `integer` | `path` | 必填 | The ID of the knowledge item to retrieve. |
| `Media type` | `` | `` | 選填 |  |

### 回應 (Responses)
- **`200`**: Successfully retrieved the knowledge content.

---

## `GET` /api/v1/import/vector/knowledge/{knowledge_id}/download
**摘要**: Downloads knowledge file from the Vector service .

This endpoint retrieves the content of a specific knowledge item from the Vector service. It requires the user to have the source:read access permission.

### 請求參數 (Request Parameters)
| 參數名稱 | 類型 | 位置 | 必填 | 說明 |
| --- | --- | --- | --- | --- |
| `knowledge_id` | `integer` | `path` | 必填 | The ID of the knowledge item to retrieve. |
| `Media type` | `` | `` | 選填 |  |

### 回應 (Responses)
- **`200`**: Successfully retrieved the knowledge content.

---

## `PUT` /api/v1/import/vector/knowledge/settings
**摘要**: Update knowledge settings (categories and labels).

This endpoint updates the categories and labels for one or more knowledge items.

## 模組: `application/json`

## 模組: `text/plain`

## 模組: `text/plain`

## 模組: `text/plain`

## 模組: `text/plain`

## 模組: `text/plain`

## 模組: `import/wizard`

---

# 模組分類：資料匯入 - 精靈嚮導 (import/wizard)

## `PUT` /api/v1/import/wizard
**摘要**: Create a flow.

Creates a flow based on the provided source data. The user must have the appropriate license and access permissions.

## 模組: `application/json`

## 模組: `application/json`

---

