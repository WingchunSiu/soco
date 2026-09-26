# SOCO

System One context offloading。根模型负责调查策略，Jev 对留在代码环境里的原文做快速判断。目标是少把原文放进根模型的上下文，从而更快、更便宜。它不承诺比根模型直接阅读更准确。

一个 TypeScript 研究原型：主模型用代码控制调查过程，把大量局部语义判断交给 Jev，再选择性读取原文。当前范围是**只读调查并回答问题**，还不是能修改、运行和测试代码的完整 coding agent。

已经包含专门的 system prompt、持久状态、代码执行反馈、主模型循环，以及 Jev HTTP adapter。CLI 是这些组件的入口。尚未证明准确性、费用或速度优势。

## 开始

需要 Node.js 22+。本机已有 `/Users/michaelx/.nvm/versions/node/v22.16.0/bin/node`；默认 shell 可能仍是 Node 20。可先临时设置 PATH，不必修改全局配置：

```sh
export PATH=/Users/michaelx/.nvm/versions/node/v22.16.0/bin:$PATH
cd /Users/michaelx/research/soco
npm ci --ignore-scripts
npm test
npm run demo
```

首次搭建时已安装依赖、构建并创建空白配置 `.env`。以后重装才需要 `npm ci`。`demo` 不联网：主模型动作是预写脚本，Jev 是关键词 mock，只验证连通性。demo 的答案会明确标注 MOCK。

## 配置

编辑**此项目根目录**的 `.env`，先只填这一项就能测试真实 Jev：

```dotenv
TYPESAFE_API_KEY=你的密钥
JEV_MODEL=jev-latest
```

配置总是从项目目录加载，不会从被分析仓库中寻找 `.env`。现有进程环境变量优先。密钥不放进 prompt、请求日志或代码执行子进程。`.env` 和 `runs/` 已被 Git 忽略；模板是 `.env.example`。

真实 `select` / `jev.filter` 会将候选块的**全文**和问题发给 TypeSafe，并消耗 API 用量。只在指定 `--root` 范围内读取支持的文本文件；路径过滤排除 dotfiles、常见生成目录、显式凭证文件名及符号链接，但它不是通用秘密检测器。

自动主模型循环还需要：

```dotenv
ROOT_PROVIDER=xai
ROOT_MODEL=grok-4.7
ROOT_API_KEY=对应 provider 的密钥
```

```sh
npm run jev -- models --provider xai
```

主模型适配器使用锁定版本的 `@mariozechner/pi-ai` 0.73.1；没有读取或复用个人 Pi 登录凭证。上游已更名为 `@earendil-works/pi-ai`；本原型先锁定已验证接口，后续迁移仅需调整 `src/root.ts`。不需要安装 Pi coding agent。其他 provider 可通过同一适配器选择，但尚未实测。

当前选择 xAI 官方端点 `https://api.x.ai/v1`，模型 ID 为 `grok-4.7`。旧 SDK 目录缺少该模型，因此在 `src/root.ts` 补充了定义，没有替换成其他 Grok 版本。`ROOT_API_KEY` 应为 xAI 原生 API key；第三方网关 key 需要相应的 provider/endpoint。模型定义中的 4096 是本原型的输出上限。费用估算采用官方普通上下文价格，不能用于超过 200K 输入的高上下文计价。[模型依据](https://docs.x.ai/developers/models/grok-4.7)

## 三个真实入口

### 1. 单独检查 Jev 的筛选结果

```sh
npm run jev -- select \
  --root examples/repo \
  --query '哪些代码可能解释用户 logout 后 session 仍然有效？'
```

输出每块的概率、候选引用、未知分数、用量和 trace 路径。这个命令只做筛选，不自动读取正文、不调用主模型。用 `--path src/auth` 缩小范围；加 `--mock` 只测试接口，不能用于评估判断质量。

### 2. 持久代码会话：只有 Jev key 也可以使用

```sh
npm run jev -- session --root examples/repo
```

每行输入一个 JSON 对象；每次返回一行 JSON。依次输入：

```json
{"code":"state.refs = await repo.blocks('.'); print(state.refs);"}
{"code":"state.pick = await jev.filter(state.refs, '哪些代码可能解释 logout 后 session 仍有效？'); print(state.pick.matches);"}
{"code":"for (const ref of state.pick.matches) print(await repo.read(ref));"}
```

如果接到另一个 agent，由它持续驱动这个进程即可。机器调用建议直接用 `node dist/src/cli.js session ...`，避免 npm 的启动信息混入 stdout。诊断和 trace 路径写 stderr。stdin EOF 关闭会话。

### 3. 主模型自动完成调查

```sh
npm run jev -- run \
  --root examples/repo \
  --task '为什么 logout 后 session 可能仍有效？请用文件和行号支持结论。' \
  --mode jev --max-steps 12
```

主模型收到环境说明和使用示例，然后自己产生 code / final 动作。每次代码执行的有限输出反馈给下一轮。`completed` 只表示模型输出了最终答案，不代表答案经过评分或验证；超出步数返回 `budget_exhausted`，退出码 2。请求错误退出码 1。

不用 Jev 的对照：

```sh
npm run jev -- run \
  --root examples/repo \
  --task '为什么 logout 后 session 可能仍有效？请用文件和行号支持结论。' \
  --mode read --max-steps 12
```

两种模式共享 root adapter、原文读取、关键词搜索和执行循环。read 模式没有 `jev` 对象，也没有 Jev 使用示例。相同步数不等于相同费用；后续需要根据实际用量配平预算。

## 模型的代码环境

执行的是 **JavaScript**（实现语言是 TypeScript）。每个 cell 支持 `await`，保留的变量写到 `state` 上。cell 内 `let` / `const` 只在该 cell 生效。没有任意模块导入或 shell API。

| 操作 | 返回 |
|---|---|
| `await repo.files(path)` | 相对文件路径 |
| `await repo.symbols(path)` | 声明行 `{id,path,start,end,label,text}`，只有声明那一行 |
| `await repo.blocks(path)` | `{id,path,sha256,start,end,chars}` 引用，不含正文 |
| `await repo.search(literal, path)` | 包含字面字符串的块引用，最多 100 个，显式标记截断 |
| `await repo.window(path, start, end)` | 最多 80 行的编号窗口，留在代码环境里，不自动打印 |
| `await jev.ask(material, questions)` | 同一份材料上最多 16 个独立判断；返回概率，不返回解释 |
| `await jev.filter(refs, question, threshold?)` | 块级筛选：matches、judgments、unknown、belowThreshold |
| `await jev.locate(question, views)` | 行号 Choice 加 present Noul 的快捷方式 |
| `await repo.lines(spans, padding?)` | 按已有 span 读取原文，padding 0..8 |
| `await repo.read(ref, padding?)` | 保留原始换行的文本、一基行号和内容 hash |
| `print(value)` | 将结果提供给主模型 |

`jev.ask` 是通用动作。主模型写问题，代码决定把哪段材料送进去。一次请求可以带最多 16 个互相看不见答案的问题，类型是 `noul`、`choice` 或 `score`。Choice 只能选代码列出来的选项，所以没有答案时要自己加 `none`。结果留在 `state`，只把要分支的概率打印回主模型。`locate` 仍是“指出一行”的快捷方式；`filter` 仍是整块丢弃。Jev 不写解释，也不保证找全。

2026-09-25 对这个三文件 fixture 做了两次真实 `locate`，不是自动调查。声明行一次请求：`present` 0.87，`greeting` 概率为 0，概率集中在 `logout`、`isAllowed`、`allowCache`、`revoked`。把 `auth.ts` 的 13 行编号后再问一次：`present` 0.97，`allowCache.has` 那一行 0.97，其余行接近 0。这只说明这个动作能把判断指到行，不说明主模型会自己走完这条路径，也不构成对照实验。

符号提取是正则，不是解析器。漏掉的声明仍可通过 `repo.search` 和 `repo.read` 找回。`filter` 保留，用来先丢掉明显无关的文件；它不指出哪一行重要。

例如可以先列出声明，再让 Jev 选该打开的行：

```js
state.view = await repo.window("auth.ts", 1, 40);
state.judge = await jev.ask(state.view.lines, {
  cache_before_revoke: { type: "noul", instructions: "Does a cache check return before a revocation check?" },
  logout_clears_cache: { type: "noul", instructions: "Does logout remove the allow cache entry?" }
});
print(state.judge.answers);
```

程序自动生成每块的问题 ID；真实正文放进该问题的 `instructions.source_block`，不能只把 ID 交给 Jev。默认阈值 0.35 尚未调优；缺失或非法分数记为 unknown 并留在候选中。低分块的引用也保留在 `judgments`。评分永远不保证证据完整，主模型仍可补读任何已登记的块。

## 文件结构

```text
src/corpus.ts       文件范围、分块、版本化引用、原文读取和字面搜索
src/jev.ts          官方 HTTP 接口、Noul 批处理、用量与调用预算
src/cell-worker.ts  代码环境、state、print、host RPC
src/runtime.ts      子进程生命周期、执行反馈和超时
src/prompt.ts       主模型操作说明、策略和示例
src/harness.ts      模型 → 代码 → 观察 → 模型的循环
src/root.ts         Pi 模型调用层适配器
src/cli.ts          配置加载、各入口和 trace
src/mock.ts         明确标记的离线假实现
test/core.test.ts   协议与关键行为测试
examples/repo/     人工构造的跨文件 auth/cache 问题
runs/              本地 JSONL 轨迹（Git ignored）
```

## 记录和边界

- trace 记录实际 system prompt、任务、主模型回复、代码、观察、Jev 请求的候选 ID、分数、用量和耗时。会包含被读取的源码；不要把这些日志默认上传。
- root usage 含 SDK 返回的 token/cache 统计及**估算费用**；Jev 保留实际返回的 token 用量，没有硬编码价格。未返回用量明确计为 unknown，不声称是零费用。
- `sourceCharsReturned` 是从源文件返回到代码环境的字符数；`observationChars` 是代码输出给主模型的字符数。二者不是 token，也不等价于模型实际阅读量；以 root API usage 为准。
- `requestsReserved` 是为整个 filter 批次预留的额度，`requests` 是实际尝试的 transport 调用。失败后的未用预留不自动退回，避免隐式重试产生额外费用。
- 默认每次调查最多 12 次 root 调用、20 次 Jev 请求。另有每 cell 100 次操作、120 秒超时及 12000 字符输出上限。并发 filter 共享 Jev 请求预算。
- 每块最多 60 行 / 6000 UTF-16 code units；非 AST 分块。每文件最多 1 MB，会话最多存 5 MB 文件快照；每次 filter 最多 256 块。请求最多 24 问 / 24 KB UTF-8 JSON；不当作精确 token 限制。
- 来源发生变化后拒绝继续使用旧引用，需重新取得 refs。尚未实现依赖展开、答案缓存、跨会话状态、自动 context compaction 或任务评分器。
- 子进程能限制卡死的执行时间，**不是针对恶意代码的安全沙箱**。Node `vm` 也不是安全边界；宿主机权限依然存在。当前只供受信任的本地研究任务。真实 provider 的密钥不注入该子进程，但不能据此声称 hostile-code isolation。
- 必须 await repo / Jev 调用；发现仍在进行的未等待调用时会关闭会话。不要在一条 cell 中启动后台任务。

## 验证状态与下一步

当前验证：TypeScript 编译、离线测试、mock agent 循环和模型配置解析。2026-09-25 的第一次真实调查只有块级 `filter`：主模型找到了 cache/revocation 问题，但最后把三个文件都读了。记录见 [真实 smoke test](SMOKE_TEST.md)。之后的 `locate` 是为了让 Jev 返回行级判断；它是否真的减少阅读，要以新的对照记录为准，不能用旧的五轮轨迹代替。

完整 API smoke test 已通过；任务中明确要求先调用 Jev，所以还不能说明 agent 会自发选择它。下一步选一组需要跨文件找证据的真实调查题，固定 root、任务和模型版本，比较 read / jev 两种模式的答案质量、关键证据遗漏、总费用和墙钟时间；再加入普通小模型筛选对照，区分委托本身与 Jev 的收益。

接口依据：[TypeSafe quickstart](https://docs.typesafe.ai/introduction/quickstart)、[Noul 与 structured instructions](https://docs.typesafe.ai/primitives/noul)。设计参考：[RLM minimal](https://github.com/alexzhang13/rlm-minimal)。
