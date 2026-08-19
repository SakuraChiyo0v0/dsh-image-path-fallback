# @dsh-external/dsh-image-path-fallback

> 仓库：https://github.com/SakuraChiyo0v0/dsh-image-path-fallback

DSH 插件：当当前模型不支持图片输入时，自动把用户发送的图片降级为**本地文件路径 + 提示文本**，让纯文本模型也能借助识图 skill 读取图片。

不需要修改 DeepSeek Harness 核心源码。

## 功能

- 自动放行核心 api-proxy 的图片准入检查
- 在 `agent/pre-step` 阶段把 `image` block 替换为：
  - **路径模式**：可自定义的提示文案，例如：
    ```text
    [用户发来一张图片，已保存到: <workspace>/.dsh-image-fallback/<id>.png]
    请使用你的识图 skill（或可用的图片读取工具）读取该文件，获取图片内容后继续回答。
    ```
  - **子代理模式**：调用一个可识图模型的子代理分析图片，把分析结果文本注入主对话
- 设置页提供：
  - 「图片降级」总开关
  - 模式切换：`path` / `subagent`
  - 路径模式提示模板（支持 `{filePath}` 占位符）
  - 视觉子代理的 Provider / Model / 提示词（支持 `{filePath}`）
- 配置持久化到：
  ```text
  ~/.dsh/dsh-image-path-fallback/settings.json
  ```

## 安装

### 方式一：本地源码 link（开发）

```bash
cd /path/to/deepseek-harness
pnpm dsh plugin --profile web add /path/to/dsh-image-path-fallback
```

### 方式二：远程 GitHub（推荐）

```bash
pnpm dsh plugin --profile web add github:SakuraChiyo0v0/dsh-image-path-fallback#<commit>
```

### 方式三：npm（发布后）

```bash
pnpm dsh plugin --profile web add @dsh-external/dsh-image-path-fallback@<version>
```

## 使用

1. 安装并重启 DSH
2. 打开 **设置 → 图片降级**
3. 保持开关开启，选择模式并保存
4. 在对话中直接发送图片，即使当前模型不支持视觉，也会自动降级

### 路径模式

默认模式。图片保存到工作区 `.dsh-image-fallback/`，然后把自定义模板文本交给主模型。

模板可用占位符：

| 占位符 | 说明 |
|---|---|
| `{filePath}` | 图片的绝对文件路径 |

### 子代理模式

插件会自动：

1. 保存图片到工作区
2. 启动一个 `spawn` 子代理，使用视觉模型分析图片
3. 把子代理返回的文本结果注入主对话

Provider / Model 可以：

- **留空**：自动从 DSH 系统已注册的模型里找第一个声明支持图片输入的模型
- **手动指定**：填写具体的 Provider + Model

子代理提示词同样支持 `{filePath}` 占位符。

## 工作原理

1. 包装 `ctx.llm.resolveModelInfo`
   - 当开关开启时，让不支持图片的模型临时声明支持 `image`
   - 这样核心 api-proxy 不会在入口直接拒绝
2. 监听 `agent/pre-step`
   - 在模型真正调用前，把 `image` block 替换成图片文件路径 + 识图提示
   - 图片字节通过 `ctx.attachments.readImage()` 读取
   - 写入当前会话工作区 `.dsh-image-fallback/` 目录
3. 设置页通过 loopback RPC 读取/写入开关状态

## 构建

### 环境要求

- Node.js >= 22
- 一个 DeepSeek Harness checkout（用于提供 tsc / tsdown / 类型依赖）
- pnpm 或 npm

### 构建命令

```bash
# 1. 构建宿主端（src/index.ts → lib/index.js）
DSH_CHECKOUT=/path/to/deepseek-harness bash scripts/build.sh

# 2. 构建客户端（src/client/index.ts → lib/client.js）
node /path/to/deepseek-harness/node_modules/.bin/tsdown
```

也可以使用 DSH 插件开发工具链：

```bash
dev_build_plugin {"dir": "/path/to/dsh-image-path-fallback"}
```

### 构建产物

```text
lib/
├── index.js          # 宿主端 bundle
├── index.js.map
├── client.js         # 客户端 bundle（ModuleLoader 注册）
├── client.js.map
└── types/            # TypeScript 声明
```

> 注意：远程 git 安装需要把 `lib/` 提交进仓库，否则 pnpm 安装后没有运行入口。

## 项目结构

```text
dsh-image-path-fallback/
├── src/
│   ├── index.ts          # 宿主端：能力放行 + agent/pre-step 转换 + RPC
│   └── client/index.ts   # 客户端：设置页「图片降级」开关
├── scripts/
│   └── build.sh          # 宿主端构建脚本（链接 DSH checkout 依赖）
├── lib/                  # 构建产物（提交到仓库，保证远程安装可用）
├── cordis.patch.yml      # DSH bundle patch
├── tsconfig.json
├── tsdown.config.ts      # 客户端构建配置
├── package.json
└── README.md
```

## 注意事项

- 图片会保存到当前会话工作区的 `.dsh-image-fallback/` 目录。
- 该插件会把当前模型在能力查询中“临时声明为支持图片”，以绕过核心准入；真正发送给模型的仍是纯文本路径。
- 如果你依赖 DSH 自带的 `read_image` 工具，它也会因为能力查询被放行而允许执行；如果它返回 image block，仍可能被纯文本模型拒绝。建议识图 skill 使用“读取图片文件并返回文字描述”的方式。
- 这是早期版本，建议先小范围测试。

## License

BSD-3-Clause
