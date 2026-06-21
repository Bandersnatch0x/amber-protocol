# Amber Protocol 快速开始

欢迎使用 Amber Protocol！本指南帮助你在 5 分钟内上手。

## 📦 安装

### 从 npm 安装（推荐）

```bash
npm install -g amber-protocol
amber --version
```

### 从源码安装

```bash
git clone https://github.com/Bandersnatch0x/amber-protocol.git
cd amber-protocol
npm install
node scripts/amber.js --version
```

---

## 🚀 基础用法

### 1. 初始化项目

为你的仓库创建 Amber Protocol 结构：

```bash
# 初始化当前目录
amber init --target .

# 或初始化其他目录
amber init --target /path/to/your/project
```

**输出：**
- `.amber/` 目录
- `AGENTS.md` - Agent 配置
- `CLAUDE.md` - Claude 指令
- Feature state 文件

### 2. 审计项目

检查项目的 Amber 就绪度：

```bash
amber audit --target . --summary
```

**输出：**
- 缺失文件报告
- 配置错误警告
- 建议的改进措施

### 3. 健康检查

验证 `.amber/` 状态一致性：

```bash
amber doctor --target .
```

**输出：**
- Schema 验证结果
- 孤立文件检测
- 配置完整性检查

### 4. 生成采纳报告

为现有项目生成就绪度评估：

```bash
amber adoption report --target . --output-dir ./adoption-report
```

**输出：**
- 依赖分析
- 测试覆盖率评估
- 缺失文件清单
- 可操作建议

---

## 🌐 使用 Web 查看器

Amber Protocol 提供可视化界面，用于查看会话、路由和治理门禁。

### 启动 Web 服务

```bash
cd apps/web
npm install --legacy-peer-deps
npm run dev
```

### 访问界面

打开浏览器访问：**http://localhost:3001**

### 主要功能

- **会话管理** - 查看活动和历史会话
- **路由浏览** - 按类别浏览工作流
- **门禁监控** - 过滤和查看治理决策
- **实时更新** - SSE 推送状态变化
- **主题切换** - 明暗模式支持

---

## 📚 下一步

### 深入学习

- [CLI 参考](../CLI_REFERENCE.md) - 完整的命令列表
- [架构概览](../architecture/overview.md) - 理解系统设计
- [自主模式](../AUTONOMOUS_MODE_GUIDE.md) - 自动化工作流

### 常见任务

- [部署到生产环境](../DEPLOYMENT.md)
- [配置监控](../MONITORING_SETUP.md)
- [创建自定义技能](../user-guide/tutorials/creating-first-skill.md)

### 遇到问题？

- [故障排查指南](../TROUBLESHOOTING.md)
- [常见问题](../user-guide/faq.md)
- [GitHub Issues](https://github.com/Bandersnatch0x/amber-protocol/issues)

---

## 📖 其他资源

- **完整文档：** [docs/](../)
- **贡献指南：** [CONTRIBUTING.md](../../CONTRIBUTING.md)
- **变更日志：** [CHANGELOG.md](../../CHANGELOG.md)

---

**🎉 恭喜！你已经掌握 Amber Protocol 基础操作。** 开始探索更多功能吧！
