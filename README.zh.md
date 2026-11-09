# dsh-text-polish

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 输入框加一个按钮：用你已经选定的模型**就地改写草稿**——普通话只润色，任务类草稿扩写、细化成可以直接发送的完整需求。

[English](./README.md) | 中文

## 它做什么

在输入框里写一句话，点输入框工具栏左侧的 **润色**（英文界面为 Polish）：

- **任务 / 指令 / 需求**——例如 `帮我看看这个报错`——会被扩写、细化：补全目标与背景、明确交付物与格式、列出约束与边界、给出验收标准，必要时拆成有顺序的步骤。
- **普通叙述、提问、闲聊**——例如 `今天开会说到下个季度的目标 大概就是提升转化`——只做润色：错别字、病句、标点、中英文空格、口水话、语序。不会为了凑长度而扩写。

两种情况下结果都直接替换输入框内容，**不会自动发送**，要不要发、发之前怎么改都由你决定。

## 安装

```sh
# 从 npm 安装（已构建产物，无需任何构建授权）
dsh plugin add dsh-text-polish

# 从 git 安装（本包是纯 JavaScript，没有构建脚本，因此不需要 pnpm 的 build 白名单）
dsh plugin add github:caiyueliang/dsh-text-polish

# 从 tarball 安装
pnpm pack && dsh plugin add ./dsh-text-polish-1.0.0.tgz
```

指定 profile：

```sh
dsh plugin --profile web add dsh-text-polish
```

这个 bundle 只插入一行插件。**正在运行的 `dsh` 进程只在启动时加载 Host 半**，所以安装后请重启它；已经打开的页面会自动热重载浏览器半。

## 使用

1. 在输入框写内容；
2. 点 **润色**；
3. 输入框内容被替换为改写结果——看一眼，需要就再改，然后发送。

也可以用命令触发（从别的客户端也方便）：

```
/polish 帮我看看这个报错
```

命令会把改写后的文本作为结果返回；从输入框按钮触发时，这段文本会被写回草稿。

## 行为细节

- **模型**：跟随模型选择器当前的值（`agentDefaultModel.currentSelection()`），取不到时退化为第一个已注册服务商的首个模型。插件本身不提供模型设置。
- **语言与内容**：保留原文语言、意图、语气与身份；不编造原文没提过的事实（人名、路径、数字、日期、金额、版本号）；代码、命令、路径、URL、专有名词、Markdown 结构原样保留。
- **并发安全**：模型运行期间你改过草稿的话，结果不会覆盖你的新内容——会提示 `输入框内容已变化，未替换`。
- **长度上限**：超过 8000 字符会在调用模型前直接拒绝。
- **会话日志**：被改写的原文不会写入会话日志（命令声明了 `recordInput: false`）。但对话里会出现一条很小的 `/polish` 命令记录，因为浏览器半只能通过 DSH 的命令注册表访问主机，而每条解析成功的命令都会记 `command/run` / `command/done`；这条记录的摘要就是改写结果。

## 定位

这个插件刻意做得极简：一个按钮、一条命令，没有对话框、没有预览、没有撤销、没有缓存、没有配置项、不新增任何服务。整条改写策略就是一个可以直接读、直接改的 prompt（[`SYSTEM_PROMPT`](./index.js)）。

如果你需要"先提问澄清 → 预览编辑 → 多服务商选择 → 图形化配置页"这类完整流程，社区里已经有功能更丰富的提示词优化插件，可以看[社区插件注册表](https://github.com/vbarter/dsh-plugin-registry)。

## 兼容性

在 DeepSeek Harness `0.2.1-alpha.1`（web profile）上开发并验证。依赖内置的 `commands` 注册表与 `llm` 服务；浏览器半面向 web 客户端。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 半：改写策略、`/polish` 命令、唯一一次模型调用 |
| `client.js` | 浏览器半：注册到 `conversation.input.left` 的按钮 |
| `cordis.patch.yml` | 插入插件行的 bundle 层 |
| `locale/en.json`、`locale/zh.json` | 插件管理里的标题与描述 |
| `icon.svg` | 插件图标 |

### 本地开发

```sh
dsh plugin add /absolute/path/to/this/checkout
```

- 改 `index.js`（prompt、命令）后需要重启 `dsh`；
- 改 `client.js`（按钮）后打开的页面会自己热重载。

## 已知限制

- 只支持 web 客户端，没有 TUI 入口。
- 每次改写会在对话里留下一条 `/polish` 命令记录。
- 没有预览、没有撤销、没有结果缓存（这是刻意的）。
- 输入上限 8000 字符，不处理附件。

## 许可证

[MIT](./LICENSE)。与 DeepSeek 官方无关。
