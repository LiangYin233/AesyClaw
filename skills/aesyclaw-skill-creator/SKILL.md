---
name: aesyclaw-skill-creator
description: 当用户要求创建、改写、扩展或整理 AesyClaw 的 Skill 时使用。用于指导如何为本项目编写外置 Skill、确定目录、撰写 SKILL.md，并保持内容精简、可触发、可维护。
---

# Skill Creator

为 AesyClaw 创建或更新 Skill 时，按下面流程执行。

## 先判断放哪

- 所有“创建 Skill / 修改 Skill / 扩展 Skill / 重写 Skill”的操作，一律只写到 `.aesyclaw/skills/<skill-name>/`
- 不要为这类用户请求创建或修改 `skills/<skill-name>/` 下的内置 Skill，除非用户明确要求维护仓库内置 Skill 且这是开发者任务
- 面向普通用户的 Skill 制作与迭代，默认都视为外置 Skills
- 如果内置和外置同名，系统会优先使用内置 Skill，所以创建外置 Skill 时必须避开现有内置重名

## 先定清楚这几个点

- 这个 Skill 解决什么重复问题
- 哪些用户表述应该触发它
- 它是偏流程指导、偏领域知识，还是需要脚本/模板
- 需要新建外置 Skill，还是只更新已有外置 Skill

如果需求不清楚，优先补齐：

- Skill 名称
- 触发场景
- 输入输出预期
- 是否需要附带 `scripts/`、`references/`、`assets/`

## 命名规则

- 目录名只用小写字母、数字、连字符
- 名称尽量短，直接表达动作或领域
- 优先用动词或任务名，如 `release-helper`、`sql-review`
- 不要和现有内置 Skill 重名

## 文件结构

对用户创建的外置 Skill，最小结构只有一个文件：

```text
<skill-root>/
└── SKILL.md
```

需要时再加：

```text
<skill-root>/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

不要额外创建 README、CHANGELOG、使用说明之类文件，除非用户明确要求。

## 写 SKILL.md 的规则

`SKILL.md` 必须包含 YAML frontmatter：

```md
---
name: skill-name
description: 清楚描述这个 Skill 在什么场景下应该被触发
---
```

正文只保留模型真正需要的内容：

- 什么时候使用
- 应该如何推进任务
- 关键限制
- 需要时去读哪些附加文件

避免：

- 大段常识性解释
- 和模型默认能力重复的内容
- 与项目无关的通用提示词废话

## 推荐写法

正文通常按这个顺序组织：

1. 任务目标
2. 使用时机
3. 操作步骤
4. 特殊约束
5. 需要时再读哪些参考文件

短 Skill 直接写在 `SKILL.md` 里即可。  
长 Skill 把细节拆到 `references/`，并在 `SKILL.md` 明确说明“什么时候读哪个文件”。

## 针对 AesyClaw 的额外约束

- 这个项目的 Skill 是给 Agent/LLM 用的，不是给人看的产品文档
- 用户要求你创建或修改 Skill 时，目标目录默认是 `.aesyclaw/skills/`，不是仓库内置 `skills/`
- 触发描述要覆盖“用户怎么说”而不是只写“这个 Skill 是什么”
- 如果 Skill 涉及本项目的工具、Provider、Session、Memory、Channel 等能力，要写清楚应该优先使用哪些现有接口
- 如果 Skill 需要读仓库内固定路径，要在正文里写明路径
- 如果 Skill 需要脚本，优先把稳定、重复、易出错的步骤放到 `scripts/`

## 更新已有 Skill 时

- 保持原目录名不变，除非用户明确要求改名
- 先读现有 `SKILL.md`
- 不要把短 Skill 越改越臃肿
- 只有在触发条件真的变化时才改 `description`
- 如果新增了 `references/` 或 `scripts/`，要在 `SKILL.md` 里写明何时使用

## 完成前检查

- frontmatter 的 `name` 和目录名一致
- `description` 足够具体，能帮助系统正确触发
- 内容精简，没有 README 式废话
- 目录在 `.aesyclaw/skills/<skill-name>/`
- 没有误写到仓库内置 `skills/`
- 确认它不依赖“内置 Skill 固定启用”这类假设
- 如果改了已有 Skill，确认没有破坏原有触发场景
