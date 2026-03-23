# Everything Claude Code 项目分析

## 项目定位

这个仓库本质上不是一个“业务应用”，而是一套给 AI 编码代理使用的“工程化运行时 + 能力分发包”。它把提示词、子代理定义、技能库、命令库、hooks、规则、安装器、状态管理、测试与跨平台适配整合在一起，目标是把 Claude Code、Codex、Cursor、OpenCode 这类 agent harness 调教成更稳定、更可控、更像资深工程师的工作流系统。

从仓库里的实际内容看，它当前是一个成熟的产品化分发仓库，而不是零散配置集合：有 `25` 个 agents、`57` 个 commands、`108` 个 skills、完整的 hook runtime、选择性安装 manifest、CLI、SQLite 状态查询命令，以及测试与校验链。核心说明在 [README.md](../README.md)、[package.json](../package.json)、[AGENTS.md](../AGENTS.md)。

## 它到底在做什么

它做的事可以概括成 5 层：

### 1. 规则层

把团队/个人想让 AI 始终遵守的工程规范固化下来，比如 TDD、80% 覆盖率、安全检查、immutability、Git 工作流、性能与上下文管理。这部分在 `rules/` 下面，按 `common + language packs` 组织。

### 2. 能力层

把不同任务拆成可复用能力单元。

- `agents/` 是“角色型子代理”，例如 planner、architect、security-reviewer、code-reviewer、build-error-resolver。
- `skills/` 是“方法论/领域知识包”，例如 TDD、verification-loop、frontend-patterns、market-research、deep-research、security-review、frontend-slides、x-api 等。

### 3. 交互层

把常用工作流做成斜杠命令。比如 `/plan`、`/tdd`、`/code-review`、`/verify`、`/quality-gate`、`/loop-start`、`/model-route`、`/sessions`、`/harness-audit`。这部分在 `commands/`。

### 4. 自动化运行时

通过 hooks 在会话开始、编辑文件、运行命令、会话结束等时机自动触发行为，例如：

- 加载上下文
- 保存 session
- 建议 compact
- 格式化代码
- TypeScript 检查
- `console.log` 检查
- 质量门禁
- 成本跟踪
- 从会话中提取可学习模式

配置在 `hooks/hooks.json`，实现主要在 `scripts/hooks/`。

### 5. 安装与适配层

它不是只服务 Claude Code，而是做了多平台适配：

- `.claude-plugin/` 面向 Claude Code 插件
- `.codex/` 面向 Codex
- `.cursor/` 面向 Cursor
- `.opencode/` 面向 OpenCode

安装不是硬编码复制，而是 manifest 驱动的 profile/module/component 选择性安装，见：

- `manifests/install-profiles.json`
- `manifests/install-components.json`
- `manifests/install-modules.json`

## 主要功能

按功能看，这个项目覆盖面非常广：

- `工程开发工作流`
  规划、TDD、代码评审、构建修复、E2E、覆盖率、重构清理、文档更新、质量门禁。
- `多语言支持`
  TypeScript、Python、Go、Java、Kotlin、Rust、Perl、PHP、Swift、C++ 等都有规则或技能包。
- `安全能力`
  安全 reviewer、security-review skill、安全扫描、输入校验、secret 管理、提交前检查。
- `上下文与记忆管理`
  SessionStart/Stop hooks、pre-compact、strategic compact、持续学习、instinct import/export/evolve。
- `多代理编排`
  worktree/tmux orchestration、multi-plan、multi-execute、loop-start、loop-status、PM2 工作流。
- `研究与内容能力`
  deep-research、market-research、article-writing、investor-materials、investor-outreach、crosspost、x-api。
- `媒体与文档能力`
  frontend-slides、fal-ai-media、video-editing、visa-doc-translate、document-processing 类技能。
- `运行状态与诊断`
  `ecc` CLI 支持 `install/plan/list-installed/doctor/repair/status/sessions/session-inspect/uninstall`。

## 这个仓库的实际架构

你可以把它理解成下面这条链路：

用户请求  
→ 命令或 AGENTS 指令触发  
→ 选择合适 agent / skill / rule  
→ hooks 在关键时机做自动检查与状态保存  
→ scripts 负责真正执行安装、审计、诊断、状态查询  
→ 不同平台目录把同一套能力映射到 Claude / Codex / Cursor / OpenCode

这也是为什么它看起来像“文档很多”，但其实不是文档仓库。Markdown 只是配置载体，真正的产品能力来自：

- 结构化规则
- 可组合技能
- 自动化 hooks
- 安装与运行时脚本
- 测试和校验链

## 最值得注意的几个特点

- 它强调“agent-first”，不是单 agent 直接硬做，而是主动委派给 planner、reviewer、security-reviewer 等角色。
- 它强调“research-first”和“verification-first”，不是只生成代码，还要求验证、评审、学习、沉淀。
- 它已经从 Claude Code 配置包，演化成“AI agent harness performance system”。
- 它支持“按需安装”，不是所有用户都要装全量能力。
- 它把“经验”产品化了：把作者长期使用中总结的流程，固化成规则、命令、hook 和技能。

## 适合什么人用

最适合这几类人：

- 想把 Claude Code / Codex / Cursor 调成稳定工程助手的个人开发者
- 想给团队统一 AI 编码规范和工作流的技术负责人
- 需要多语言、多框架、多工具链支持的工程团队
- 想做 AI agent orchestration、持续学习、自动质量门禁的人

## 一句话总结

这个项目是在做一套“给 AI 编码代理装上的工程操作系统”。它不是帮你开发某个业务功能，而是帮你把 AI 开发这件事本身标准化、自动化、可复用、可审计。

## AI 代码正确性保障与自动化测试

这个项目保证“AI 生成代码正确”的方式，不是靠某一个单点机制，而是靠一整套分层校验体系。核心思路是：先用规则约束 AI 的行为，再用 hooks 做即时检查，再用命令触发系统性验证，最后用测试和覆盖率把这些机制本身也测住。

先说结论：它并不能“数学上保证” AI 代码一定正确，但它把常见错误尽量前移、自动化、制度化了。也就是说，它主要保证的是“高概率正确 + 尽早暴露问题 + 可重复验证”，而不是一次生成就绝对无误。

### 一、它如何保证 AI 代码更靠谱

#### 1. 规则约束

仓库把 TDD 设成默认工作方式，明确要求先写测试，再写实现，再验证覆盖率，最低 80%。这不是建议，而是写进规则和 skill 的硬约束。也就是说，AI 理想状态下不是“先瞎写代码再补测试”，而是按 RED → GREEN → REFACTOR 的节奏工作。

#### 2. 任务分工

它鼓励把任务分给专门 agent，比如：

- `tdd-guide` 负责测试优先
- `code-reviewer` 负责改完后的质量检查
- `security-reviewer` 负责敏感逻辑
- `build-error-resolver` 负责构建和类型问题

这能降低一个 agent 同时负责“写代码、判断自己对不对、审查自己”的自我偏差。

#### 3. Hooks 即时纠偏

只要 AI 编辑文件，hooks 就会在后台做一些轻量但高频的自动检查，尽量在错误扩散前拦住。

#### 4. 人工触发的深度验证

比如 `/verify`、`/quality-gate`、`/test-coverage`、`/eval`，这些命令要求 AI 在关键节点主动跑构建、类型检查、lint、测试、覆盖率、安全扫描、差异审查。

#### 5. 项目自身也被测试

这个仓库不只是要求别人测试，它自己的 hook、安装器、manifest、命令和适配逻辑都有自动化测试和 CI 校验。

### 二、具体自动化机制有哪些

#### 1. TDD 机制

TDD 是第一道“正确性”防线。它要求：

- 先写测试
- 先运行并确认测试失败
- 再写最小实现让测试通过
- 再重构
- 最后检查覆盖率是否达到 80%+

它强调三类测试都需要：

- 单元测试：函数、组件、工具方法
- 集成测试：API、数据库、服务交互
- E2E 测试：关键用户路径

这意味着它不是只关心“代码能跑”，而是要求对行为、边界条件、错误路径都建立测试样例。

#### 2. 编辑后的自动 hook 检查

这是最接近“实时守门员”的部分。

- `post-edit-format`
  文件编辑后自动格式化 JS/TS，支持 Biome 或 Prettier。
- `post-edit-typecheck`
  编辑 `.ts/.tsx` 后自动找最近的 `tsconfig.json`，跑 `tsc --noEmit`，并尽量只过滤出和当前文件相关的错误。
- `quality-gate`
  编辑后跑轻量质量门禁。对不同语言用不同工具：
  - JS/TS/JSON/MD 走 Biome 或 Prettier
  - Go 走 `gofmt`
  - Python 走 `ruff format`
- `check-console-log`
  每次响应结束时检查已修改的 JS/TS 文件里是否残留 `console.log`。

这一层解决的是“写完马上出问题”的场景，比如格式错、类型错、调试语句没删掉。

#### 3. 系统化验证命令

最核心的是 `/verify`。它要求按顺序做：

1. Build Check
2. Type Check
3. Lint Check
4. Test Suite
5. Security / Secrets / `console.log` 审计
6. Git diff 审查

这里的关键点不是“有这些命令”，而是顺序。比如 build 都不过，就不应该继续往下假装验证通过。

另外还有两个辅助命令：

- `/quality-gate`
  按路径或项目范围手动执行质量管线，适合在 hook 之外主动检查。
- `/test-coverage`
  专门做覆盖率分析，找出低于 80% 的文件，并按缺口补测试。

这说明它不把“测试通过”当成终点，还要求你看覆盖率盲区。

#### 4. Eval 机制

这是更偏 AI 工程的方法，不只是传统代码测试。

它引入几类概念：

- `Capability eval`
  AI 是否具备某个新能力
- `Regression eval`
  新改动是否破坏旧行为
- `pass@1 / pass@3 / pass^3`
  用来评估 AI 在多次尝试中的稳定性

这和普通单元测试不同。普通测试是“代码对不对”，eval 更像“AI 工作流整体是否稳定地产出对的结果”。

#### 5. 会话级持续学习与回放

这不是直接验证代码是否正确，但它能减少 AI 因“失忆”导致的错误重复。

- `session-start`
  会话开始时加载上次 session 摘要、已学习技能、项目类型等上下文。
- `session-end`
  每次 Stop 时从 transcript 中提取用户请求、用过的工具、修改过的文件，写入 session 文件。
- `evaluate-session`
  会话结束时判断这次对话里有没有可抽取的稳定模式，供后续沉淀成 skill。

这层对“正确性”的贡献是减少上下文断裂、避免同类错误反复出现。

### 三、这个仓库自己做了哪些自动化测试

这部分很关键。因为如果这些 hooks、命令、安装器本身不可靠，那整套“保障正确性”的系统就是空的。

当前仓库有 50+ 个测试文件，覆盖范围很广，测试类别大致分为：

- `hooks 测试`
  覆盖 quality-gate、evaluate-session、auto-tmux-dev、hook flags 等行为。
- `安装与配置测试`
  覆盖 install-plan、install-apply、manifest、install-state 等逻辑。
- `CLI 和脚本测试`
  覆盖 `ecc`、`harness-audit`、`doctor`、`repair`、`session-inspect` 等命令。
- `底层库测试`
  覆盖 formatter 解析、包管理器检测、项目类型识别、状态存储等基础能力。
- `集成级测试`
  验证 hooks 和整体链路在组合情况下是否按预期工作。

### 四、除了业务测试，还有“结构正确性”校验

这个项目还有一类很实用的自动化：不是测业务逻辑，而是测仓库里的“配置资产”有没有坏掉。也就是 agents、commands、skills、rules、hooks 这些内容是否仍然有效。

`npm test` 里会先跑一串 validator，再跑测试，包括：

- `validate-agents.js`
  检查 agent Markdown 是否有 frontmatter、必需字段、合法模型值。
- `validate-commands.js`
  检查命令文档非空，以及引用的 command / agent / skill 是否存在。
- `validate-rules.js`
  检查所有 rule 文件是否非空可读。
- `validate-skills.js`
  检查每个技能目录是否有 `SKILL.md`。
- `validate-hooks.js`
  检查 `hooks/hooks.json` 的 schema、事件名、matcher、hook 类型和字段是否合法。

这类测试很重要，因为 ECC 本身大量依赖 Markdown 和 JSON 配置文件。少一个字段、拼错一个 agent 名称，普通代码单测未必能及时发现，但 validator 能直接拦住。

### 五、覆盖率是怎么要求的

它明确要求 80%+ 覆盖率，这既出现在规则里，也出现在 npm 脚本里。

`package.json` 中的 `coverage` 脚本使用 `c8`，并设置了硬阈值：

- lines 80
- functions 80
- branches 80
- statements 80

也就是说，不是“跑个 coverage 看看”，而是没到门槛就失败。

### 六、它能保证“用户项目里的代码正确”到什么程度

这里要区分两件事：

#### 1. ECC 仓库自身

它自己的 hooks、命令、安装器、适配层，是有自动化测试和覆盖率门槛的。

#### 2. 用户正在开发的业务项目

ECC 并不会天然知道你的业务逻辑是否正确。它做的是提供一套强制工作流，让 AI 去：

- 先写测试
- 跑构建、类型、lint、测试
- 看 coverage
- 做 diff review
- 做安全检查
- 必要时做 eval

所以它对用户项目的保障，本质上是“把正确性验证流程自动化和制度化”，而不是“替代业务测试”。

换句话说，它更像质量系统，而不是万能判题器。

### 七、这套体系的优点和边界

优点很明确：

- 错误暴露得更早，尤其是格式、类型、调试残留这种低级问题
- AI 不容易跳过测试和验证步骤
- 支持回归验证，不只是“这次能跑”
- 对复杂 agent 工作流有 eval 思维，不只盯着代码编译通过
- 这个系统本身也被测试，不是空口宣言

但边界也很明确：

- 它不能自动理解你的业务需求是否“真正满足用户意图”
- 没有业务测试数据时，它无法凭空证明正确性
- 某些 hook 是“提醒/警告型”，不是强阻断
- 很多质量检查依赖目标项目本身配置了 `build`、`lint`、`test`、`tsc`、formatter 等工具链

### 一句话总结

这个项目保证 AI 代码“更正确”的核心，不是靠单次生成更聪明，而是靠“测试优先 + 编辑后即时检查 + 提交前系统验证 + 覆盖率门槛 + eval + 仓库自身被充分测试”的组合拳。

## 自动化测试与验证方法总表

下表汇总了这个项目中主要的自动化测试与验证方法。这里的“测试”不仅包括传统单元测试，也包括构建检查、类型检查、质量门禁、配置校验、回归评估等自动化验证手段，因为 ECC 的目标本来就不是只测代码函数，而是保障整套 AI 工程流程的正确性。

| 什么测试 | 测试的方法 | 为什么要做这个测试 | 能解决什么问题 |
|---|---|---|---|
| 单元测试 | 对单个函数、工具方法、组件逻辑编写独立测试，用最小输入输出断言行为 | 最小粒度验证功能正确性，是发现逻辑错误最快的手段 | 解决函数实现错误、边界条件遗漏、重构后回归问题 |
| 集成测试 | 测 API、数据库、服务交互、模块间协作，验证请求到响应或服务到服务的完整链路 | 很多错误不在单个函数，而在模块之间的拼接处 | 解决接口联调失败、数据库交互错误、服务调用顺序问题 |
| E2E 测试 | 用 Playwright 等浏览器自动化测试关键用户流程 | 最终用户看到的是完整流程，不是单个函数 | 解决页面流程跑不通、按钮可点但业务不成功、前后端联通失败 |
| TDD 红绿重构测试 | 先写失败测试，再写最小实现让其通过，最后重构并保持测试为绿 | 强制 AI 先定义正确行为，再写实现，降低拍脑袋写代码的概率 | 解决“先写代码后补测试”导致的伪验证、需求理解偏差 |
| Build Check | 执行项目构建命令，先确认能完整 build | 如果项目连构建都过不了，其他验证意义很小 | 解决打包失败、缺依赖、构建配置错误、语法级阻断问题 |
| Type Check | 执行 `tsc --noEmit`、`pyright` 等类型检查 | AI 很容易写出语法正确但类型不一致的代码 | 解决类型不匹配、参数传错、返回值不符合约定的问题 |
| Lint Check | 执行 ESLint、Ruff 等静态检查 | 代码不仅要能跑，还要符合项目约定和最佳实践 | 解决潜在坏味道、危险写法、风格不一致、简单逻辑疏漏 |
| 覆盖率检查 | 用 `c8`、Vitest/Jest 覆盖率、pytest-cov 等统计并设置 80% 门槛 | 测试通过不等于测得充分，需要知道哪些代码根本没被触达 | 解决测试盲区、分支未覆盖、表面通过但风险仍高的问题 |
| `/verify` 全量验证 | 按固定顺序执行 build、types、lint、tests、安全检查、diff review | 需要一个统一、可复用的“提交前体检流程” | 解决只做局部检查、漏掉关键验证步骤的问题 |
| `/quality-gate` 质量门禁 | 对文件或项目范围手动执行格式、lint、类型等质量检查 | hook 是自动触发的，但需要人工随时重跑统一质量管线 | 解决改动较多时遗漏局部错误、需要集中复查的问题 |
| `/test-coverage` 覆盖率补强 | 分析低覆盖文件，定位缺失测试并补齐 | 覆盖率不足时，仅看总体数字不够，需要知道缺口在哪 | 解决“知道不够测，但不知道该补哪”的问题 |
| `/eval` 能力/回归评估 | 定义 capability eval 和 regression eval，并记录 pass@k | AI 工程中很多问题不是普通单测能完全表达的 | 解决 prompt/agent 变化后的能力退化、稳定性不足问题 |
| Capability Eval | 为一个新能力定义成功标准并自动检查是否达成 | AI 需要被验证“会不会做这件事”，而不只是“代码能不能跑” | 解决新增能力不可度量、结果模糊、是否达标难判断的问题 |
| Regression Eval | 为已有能力定义基线，更新后重新验证 | 新功能上线最常见的风险是破坏旧功能 | 解决历史行为被破坏、升级后退化、版本回归问题 |
| pass@k / pass^k 评估 | 多次尝试统计成功率和稳定性 | AI 输出存在波动，单次成功不能说明真正可靠 | 解决“偶尔成功但不稳定”的假可靠问题 |
| 编辑后自动格式化 | `post-edit-format` 在文件编辑后自动运行 Biome/Prettier | 很多低级问题不该等到人工发现 | 解决格式漂移、代码风格不统一、格式导致的 review 噪音 |
| 编辑后自动类型检查 | `post-edit-typecheck` 在编辑 TS 文件后自动执行局部类型检查 | 越早看到类型错误，修复成本越低 | 解决刚编辑完就引入的类型错误，避免后续扩散 |
| 编辑后自动质量门禁 | `quality-gate` 按文件类型执行 Biome/Prettier/gofmt/ruff | 需要低延迟的自动化守门，尽快把错误暴露给 AI | 解决语言级格式/质量问题，减少提交前集中爆炸 |
| `console.log` 审计 | Stop hook 自动扫描修改文件中的调试输出 | AI 和人类一样，都会忘删临时调试代码 | 解决调试日志残留、噪音输出、生产代码不干净的问题 |
| 安全扫描 | 搜索 secrets、危险模式，必要时配合安全 skill / reviewer | AI 生成代码时常会忽视 secrets、输入验证等安全问题 | 解决密钥泄漏、明显安全疏漏、调试信息暴露问题 |
| Git diff 审查 | 自动查看变更文件和 diff 范围 | 仅看最终代码不够，需要知道到底改了什么 | 解决误改文件、无关改动混入、遗漏清理的问题 |
| Session Start / End 验证链 | 会话开始加载上下文，会话结束提取摘要、记录变更和工具使用 | AI 的错误很多来自上下文断裂，而不是实现能力本身 | 解决跨会话失忆、重复犯错、接手历史任务时上下文缺失 |
| 持续学习评估 | `evaluate-session` 根据会话长度和内容判断是否可提炼模式 | 好的解决方案应沉淀成可复用能力，而不是每次重学 | 解决经验无法积累、同类问题重复探索的问题 |
| Hook 配置校验 | `validate-hooks.js` 校验 `hooks.json` schema、事件、字段、hook 类型 | hook 是自动化核心，配置一坏，整套机制就失效 | 解决 hook 配置拼写错误、事件名错误、字段不合法的问题 |
| Agent 配置校验 | `validate-agents.js` 校验 agent frontmatter、必填字段、模型合法性 | agent 定义是编排基础，损坏后会直接影响 AI 工作流 | 解决 agent 元数据缺失、配置非法、引用失败的问题 |
| Command 文档校验 | `validate-commands.js` 检查命令文档非空，且引用的 command/agent/skill 存在 | 命令是用户入口，文档失真会导致执行流程错误 | 解决命令引用失效、文档和真实能力脱节的问题 |
| Skill 结构校验 | `validate-skills.js` 校验每个技能目录都存在 `SKILL.md` | skill 是核心知识单元，结构必须稳定 | 解决 skill 缺失、目录不完整、安装后不可用的问题 |
| Rule 文件校验 | `validate-rules.js` 检查规则文件是否可读且非空 | 规则是 AI 行为约束基础，空文件等于失效 | 解决规则丢失、空规则、安装后行为退化的问题 |
| 安装器测试 | 测 `install-plan`、`install-apply`、manifest、install-state 等逻辑 | 安装层错误会让整个系统装不对、装不全、装错位置 | 解决 selective install 失效、路径错误、状态记录异常 |
| CLI 测试 | 测 `ecc`、`doctor`、`repair`、`harness-audit`、`sessions` 等脚本 | CLI 是用户直接操作系统的入口，必须可靠 | 解决命令行参数解析错误、输出不符合预期、功能失效 |
| Hook 脚本测试 | 对 `quality-gate`、`evaluate-session`、`auto-tmux-dev` 等脚本做独立测试 | hook 运行频率高，任何错误都会被快速放大 | 解决 hook 误报、漏报、跨平台行为不一致的问题 |
| 集成级 hook 测试 | 将多个 hook 或相关脚本组合起来验证完整链路 | 单个模块正确，不代表组合后仍然正确 | 解决组合行为异常、事件触发顺序错误、整体链路不通的问题 |
| 状态存储测试 | 测 session aliases、state store、install state 等持久化逻辑 | ECC 很依赖状态记录来支持连续工作 | 解决状态写坏、会话恢复失败、安装状态漂移的问题 |
| 工具解析测试 | 测 formatter 检测、包管理器检测、项目类型识别等基础能力 | 自动化链路依赖环境探测，探测错了后续全错 | 解决检测错误导致执行了错误工具、走错工作流的问题 |
| Harness 审计 | `harness-audit` 检查仓库在工具覆盖、上下文效率、质量门禁等维度是否达标 | 需要从系统层面评估一个 AI harness 是否“配齐了” | 解决功能缺失、能力不完整、质量体系不闭环的问题 |

### 如何理解这张表

这张表里的方法可以分成四组：

- `开发前与开发中`
  TDD、单元测试、集成测试、E2E、编辑后 hooks。
- `提交前与交付前`
  `/verify`、`/quality-gate`、覆盖率、安全扫描、diff review。
- `AI 工程专项`
  `/eval`、Capability Eval、Regression Eval、pass@k、持续学习。
- `ECC 自身质量`
  validators、hook tests、CLI tests、install tests、state/store tests、harness audit。

也就是说，这个项目不是只在“代码写完以后”才测，而是把测试和验证铺在了整个 AI 开发生命周期里。
