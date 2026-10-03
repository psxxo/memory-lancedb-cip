# 功能清单（memory-lancedb-cip）

> 本文以插件 manifest 的 `configSchema` 为**权威来源**（README 历来低估真实功能面）。文中标出的"默认"取自 schema；未显式配置时即按默认生效。
>
> 版本：1.6.0。最近更新：2026-10-03。

## 1. 写入与抽取

| 配置键 | 默认 | 作用 |
| --- | --- | --- |
| `smartExtraction` | `false` | LLM 驱动的记忆抽取（10 类 L0/L1/L2）。**默认关闭**；关闭时走正则捕获。开启前会校验生成模型是否可用。 |
| `extractMinMessages` | `4` | 累计到多少条消息才触发抽取，避免把寒暄当记忆。 |
| `extractMaxChars` | `8000` | 送进抽取 prompt 的会话文本上限（超出按新近优先裁剪）。 |
| `batchChunkSize` | `10` | 批量抽取/去重时每批条数。 |
| `captureAssistant` | 未设 | 是否把助手回复也纳入抽取来源（默认只以用户内容为准）。 |
| `admissionControl` | 未设 | A-MAC 式写入准入：在落库前否掉低价值候选，同时保留下游去重语义。 |
| `extractionThrottle` | 未设 | 自适应节流，降低低价值或高频会话上的 LLM 花费。 |

## 2. 检索与重排

| 配置键 | 默认 | 作用 |
| --- | --- | --- |
| `retrieval.mode` | `hybrid` | 向量 + BM25 混合检索。 |
| `retrieval.rerank` | `none` | 重排：`none` / `lightweight` / `cross-encoder`。cross-encoder 需配 `rerankEndpoint` 与 `rerankApiKey`。 |
| `retrieval.candidatePoolSize` | — | 送入重排的候选数（影响外部重排成本）。 |
| `retrieval.neighborEnrichment` | 未设 | 命中后带出相邻片段，提升上下文完整度。 |
| `decay` | 未设 | 记忆时效衰减：久未命中的条目权重随时间下降。 |
| `tier` | 未设 | 分层：核心/长期/常规，配合梦境提升。 |
| `adaptive-retrieval` | 内置 | 按查询特征自适应调整检索预算。 |

另有两级钻取：**摘要层**先行，需要时按确定性触发条件下钻到 **raw 层**（逐字原文，zstd 压缩 + 索引字典）。

## 3. 自动回忆与自动捕获

| 配置键 | 默认 | 作用 |
| --- | --- | --- |
| `autoCapture` | `true` | 自动捕获会话内容进入写入管线。 |
| `autoRecall` | `false` | 每轮 prompt 前自动注入相关记忆。 |
| `autoRecallMinLength` | `15` | 过短的输入不触发回忆。 |
| `autoRecallMaxItems` | `3` | 单次最多注入条数。 |
| `maxRecallPerTurn` | `10` | 单回合回忆调用上限。 |
| `recallMode` | `full` | 回忆模式（`full` 等）。 |
| `autoRecallMaxQueryLength` | `2000` | 查询文本截断长度。 |
| `autoRecallTimeoutMs` | `5000` | 回忆超时预算。 |
| `autoRecallSuppressionDurationMs` | `1800000` | 命中后抑制窗口（默认 30 分钟），避免重复注入。 |
| `sessionCompression` | 未设 | 会话压缩：给对话文本打分并压缩，优先高信号内容。 |
| `sessionMemory` | 未设 | 会话级记忆（内置 session-memory 管线）。 |
| `sessionStrategy` | `none` | 会话管线选择：`none` / 插件 memory-reflection / 内置 session-memory。 |

## 4. 维护、整理与梦境

| 配置键 | 默认 | 作用 |
| --- | --- | --- |
| `dreaming` | 未设 | 插件自带的**确定性**梦境巡检（light → deep → rem）：按余弦相似度归档近重复、按召回计数/独立查询/得分门槛晋升 `tier: core`、产出 patterns。**不调用 LLM、不花 token**，成本是 embedding 与 CPU。`frequency` 只接受 `@daily` 或每日 cron；未设 `timezone` 时按 UTC 计算触发时刻。 |
| `memoryCompaction` | 未设 | 渐进式摘要：把语义相近的旧记忆合并为精炼条目，降噪并提升检索质量。 |
| `storageMaintenance` | 未设 | LanceDB 表维护（`table.optimize()` 清理旧版本快照），默认关闭；含 `autoCleanup` 保留策略。 |
| `selfImprovement` | 未设 | 自我改进/评审工具与动作（配合 `enableManagementTools`）。 |
| `canonicalCorpus` | 未设 | 规范语料索引（把工作区语料纳入可检索面）。 |

## 5. 作用域与工作区

| 配置键 | 默认 | 作用 |
| --- | --- | --- |
| `scopes.agentAccess.<agent>` | 由插件推断 | 每个 agent 能读到的 scope 集合。有效读取集默认为 `global` + `agent:<自身>`（含反射 scope）；显式给出即**替换**默认对。 |
| `scopes.default` | `global` | 未指定 scope 时的落点。 |
| `mdMirror` | 未设 | 把记忆镜像成工作区里的 Markdown 文件（人类可读备份）；`dir` 指定目录，解析每个 agent 的工作区。 |
| `workspaceBoundary` | 未设 | 工作区边界约束，防止跨工作区串写。 |

## 6. 模型车道（LLM / Embedding / Rerank）

三条**互相独立**的车道：

| 配置键 | 默认 | 作用 |
| --- | --- | --- |
| `llm.transport` | `host` | 生成车道由谁执行。`host`：走宿主托管运行时，**未配置 `llm.model` 时请求不带模型字段，由 OpenClaw 自己的默认模型与凭据生效**（插件不持有任何模型名/密钥）。`direct`：插件用自己的 `baseURL + model + apiKey` 直连 OpenAI 兼容端点，可在回合结束后立即抽取。 |
| `llm.model` | 未设 | 生成模型 id。**插件不自带默认值**；缺配置时报"需要配置一个能返回 JSON 的 OpenAI 兼容对话模型"。 |
| `llm.apiKey` | 未设 | 生成车道凭据。支持字面量，或 SecretRef：`{source:"env"\|"file"\|"store", provider?, id}`。`store` 读宿主的**共享密钥库**，异步预热后同步读取，未解析成功即**失败闭合**（不借用环境里的凭据、不塞默认值）。 |
| `llm.timeoutMs` | `30000` | 生成调用超时。 |
| `llm.thinkLevel` | 未设 | 推理强度（host 车道始终发送，默认 medium）。 |
| `embedding.model` | 未设 | 向量模型 id。**同样不自带默认**：缺配置时响亮提示并让 embedding 相关功能保持关闭，真正用到时才明确报错，注册阶段绝不抛。 |
| `embedding.dimensions` / `requestDimensions` | 未设 | 向量维度；未知模型可显式指定。 |
| `retrieval.rerankApiKey` | 未设 | 重排凭据（同 SecretRef 规则）。 |

> 三条车道的模型名与凭据**全部是配置项**，插件本体不含任何默认模型 id、密钥名或密钥路径。

## 7. 存储与锁

| 配置键 | 默认 | 作用 |
| --- | --- | --- |
| `dbPath` | 插件数据目录 | LanceDB 存储路径。 |
| `storage` | 未设 | 写锁等待/告警、打开超时、索引追赶、损坏表隔离等有界可观测设置。 |
| `locking` | 未设 | 多进程写入的锁策略（含 Redis）。 |
| `redisUrl` | 未设 | 跨进程锁/协调用的 Redis 地址。 |

## 8. 工具与 CLI

- **Agent 工具**：`memory_store`、`memory_recall`、`memory_forget`、`memory_update`、`memory_fact_query`、`memory_extract_pending`；`enableManagementTools` 打开后另有 `memory_list`、`memory_stats` 等管理/调试工具。
- **CLI**（`openclaw memory-cip …`）：`doctor`、`list`、`stats`、`import-markdown`、`import`/`export`、`migrate`(`check`/`run`/`verify`)、`reembed`、`upgrade`、`consolidate`、`repair-scopes`、`repair-summaries`、`sync`、`reindex-fts`、`delete-bulk` 等。
- **维护脚本**：`maintenance/upgrade-until-clean.sh` 等（随包提供，供升级/修复流程复用）。

## 9. 1.6.0 的关键变化

1. **插件自有 LLM 车道可用**：`llm.apiKey` 支持 `{source:"store"}`，从宿主共享密钥库自动取凭据；``llm.transport:"direct"`` 时可在 `agent_end` 当场抽取（实时）。
2. **未配置即跟随系统默认**：`llm.transport` 默认 `host`；宿主未暴露补全接口时退回原有直连行为，保证车道可用。
3. **不再内置任何模型默认值**：删除了硬编码的 embedding 默认模型 id；缺配置改为"明确告知需要配置什么"，未配置时相关功能失败闭合。
4. **写入更可靠**：待抽取队列写入带 fsync；超出上限不再静默丢，而是通过 `onTrim` 上报。
5. **闸门更准确**：`pluginResolvesModel`——直连车道配了 `baseURL + apiKey` 时按插件自有端点判定，不再拿宿主目录去卡它。

## 10. 已知边界

- README 的其余语言版本（DE/ES/FR/IT/JA/KO/PT-BR/RU/TW）尚未随 1.6.0 更新，可能与本文不一致——**以本文件与 manifest `configSchema` 为准**。
- `dreaming` 下形如 `dreaming.model` 的键属于兼容占位，插件自带引擎不读取它们。
