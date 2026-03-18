---
name: aesyclaw-remote-skill-downloader
description: 当用户要求查找、浏览、下载或安装远端 Skill 时使用。用于指导在 ClawHub 或类似远端来源搜索 Skill、向用户展示候选项、下载压缩包，并将 Skill 解压到 AesyClaw 的 workspace/skills 目录。
---

# Remote Skill Downloader

当用户要求你查找、下载、安装远端 Skill 时，按下面流程执行。

## 什么时候使用

当用户：

- 要你找 Skill
- 要你搜索某类 Skill
- 要你浏览远端 Skill 市场
- 要你下载某个 Skill
- 提到 ClawHub、远端 Skill、下载 Skill、安装 Skill

## 目标目录

- 所有远端下载的 Skill 一律放到 `workspace/skills/<skill-name>/`
- 不要把下载结果写到仓库内置 `skills/`
- 如果解压后目录层级多了一层，整理到最终目录里确保 `workspace/skills/<skill-name>/SKILL.md` 存在

## 推荐流程

### 1. 先搜索

- 优先使用远端来源的搜索页或详情页
- 如果是 ClawHub，优先从 `https://clawhub.ai/skills?sort=downloads` 开始
- 搜索关键词优先用英文，即使用户用中文提问
- 先找出多个候选，而不是直接下载第一个结果

### 2. 向用户展示候选

给用户列候选时，优先包含：

- Skill 名称
- 简短描述
- 作者
- 下载量或热度
- 星标或评分
- 版本
- 这个 Skill 为什么和用户需求相关

如果有多个合理候选，优先展示多个选项。

### 3. 用户确认后再下载

- 用户没有明确指定具体 Skill 时，不要直接下载
- 用户指定后，再进入详情页或下载链接
- 优先下载官方压缩包，而不是手工复制网页内容

### 4. 下载后落盘

- 将压缩包下载到临时位置
- 解压到 `workspace/skills/<skill-name>/`
- 如果解压出的目录名不规范，整理成合法 skill 目录名
- 最终确认存在 `SKILL.md`

### 5. 最后检查

- `SKILL.md` 存在
- frontmatter 的 `name` 合理
- 没有把文件放到 `skills/`
- 没有把多个 Skill 混在同一个目录

## ClawHub 特殊规则

如果来源是 ClawHub，按下面方式处理：

- 搜索入口：`https://clawhub.ai/skills?sort=downloads`
- 下载链接格式通常为：

```text
https://wry-manatee-359.convex.site/api/v1/download?slug={skill-slug}
```

- 在详情页优先找 “Download zip” 按钮
- 下载完成后解压到 `workspace/skills/<skill-name>/`

## 约束

- 搜索时优先用英文关键词
- 没有用户确认时，不要擅自安装多个 Skill
- 不要把远端 Skill 当作内置 Skill 提交到仓库
- 如果远端 Skill 缺少 `SKILL.md`，要明确告诉用户它不符合本项目 Skill 结构
- 如果远端 Skill 名称与现有内置 Skill 冲突，提醒用户改名后再安装
