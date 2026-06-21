# v1.0.0-rc.1 发布指南

## 自动化脚本

我已为你创建了完整的发布脚本：`scripts/release-v1.0.0-rc.1.sh`

## 快速发布

```bash
cd D:/code_space/coding-harness
bash scripts/release-v1.0.0-rc.1.sh
```

脚本会引导你完成：
1. ✅ 验证 Git tag（已创建）
2. 🔧 创建 GitHub 仓库（需要你在浏览器中操作）
3. 📤 推送代码到 GitHub
4. 🔐 npm 登录（首次需要输入账号密码）
5. 📦 发布到 npm（rc 标签）
6. ✅ 验证发布成功

---

## 手动步骤说明

如果你想手动执行，按以下顺序：

### 1. 创建 GitHub 仓库

访问：https://github.com/new

- Owner: `Bandersnatch0x`
- Repository name: `amber-protocol`
- Visibility: **Public**
- ⚠️ 不要勾选 "Initialize with README"

点击 "Create repository"

### 2. 添加远程仓库并推送

```bash
cd D:/code_space/coding-harness
git remote add origin https://github.com/Bandersnatch0x/amber-protocol.git
git push -u origin master
git push origin v1.0.0-rc.1
```

### 3. npm 登录（首次）

```bash
npm adduser
# 输入用户名、密码、邮箱
# 如果没有账号，访问 https://www.npmjs.com/signup 注册
```

### 4. 发布到 npm

```bash
npm publish --tag rc
```

### 5. 验证发布

```bash
npm view amber-protocol@rc
npm install -g amber-protocol@rc
amber --version  # 应显示 1.0.0-rc.1
```

---

## 发布后验证

### 快速测试

```bash
# 测试 CLI
npx amber-protocol@rc init
npx amber-protocol@rc --help

# 测试在 oh-my-openagent-dev 项目
cd D:/code_space/oh-my-openagent-dev/oh-my-openagent-dev
npx amber-protocol@rc audit --summary
npx amber-protocol@rc doctor --target .
```

### 记录验证结果

在 `docs/quality/rc-validation-report.md` 中记录测试结果。

---

## 下一步（1-2 天后）

如果 RC 测试通过，发布 v1.0.0 稳定版：

```bash
npm version 1.0.0 --no-git-tag-version
git commit -am "chore: release v1.0.0"
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin master v1.0.0
npm publish
```

未来的版本（v1.0.1+）将通过 GitHub Actions 自动发布！

---

## 需要帮助？

- GitHub 创建仓库：https://docs.github.com/en/repositories/creating-and-managing-repositories
- npm 发布包：https://docs.npmjs.com/cli/v9/commands/npm-publish
- 问题反馈：创建 issue 在 GitHub 仓库

---

**准备好了吗？运行 `bash scripts/release-v1.0.0-rc.1.sh` 开始发布！** 🚀
