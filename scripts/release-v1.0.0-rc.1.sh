#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Amber Protocol v1.0.0-rc.1 Release Script"
echo "=============================================="
echo ""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

cd "$(dirname "$0")/.."

# Step 1: 检查前置条件
echo "📋 Step 1: Checking prerequisites..."

# 检查 git tag
if git tag -l | grep -q "v1.0.0-rc.1"; then
  echo -e "${GREEN}✓${NC} Git tag v1.0.0-rc.1 exists"
else
  echo -e "${RED}✗${NC} Git tag v1.0.0-rc.1 not found"
  echo "Creating tag..."
  git tag -a v1.0.0-rc.1 -m "Release Candidate 1"
  echo -e "${GREEN}✓${NC} Tag created"
fi

# 检查 GitHub CLI
if command -v gh &> /dev/null; then
  echo -e "${GREEN}✓${NC} GitHub CLI installed"
  GH_AVAILABLE=true
else
  echo -e "${YELLOW}⚠${NC}  GitHub CLI not found (optional)"
  GH_AVAILABLE=false
fi

echo ""
echo "=============================================="
echo "⚠️  MANUAL ACTIONS REQUIRED"
echo "=============================================="
echo ""

# Step 2: GitHub 仓库创建
echo "📦 Step 2: Create GitHub Repository"
echo ""
echo "Please create a GitHub repository manually:"
echo ""
echo "  1. Go to: https://github.com/new"
echo "  2. Owner: Bandersnatch0x"
echo "  3. Repository name: amber-protocol"
echo "  4. Visibility: Public"
echo "  5. Do NOT initialize with README (we have one)"
echo "  6. Click 'Create repository'"
echo ""
echo "After creation, the remote URL will be:"
echo "  https://github.com/Bandersnatch0x/amber-protocol.git"
echo ""
read -p "Press ENTER after you've created the repository..."

# 添加远程仓库
echo ""
echo "Adding remote origin..."
if git remote | grep -q "origin"; then
  echo "Remote 'origin' already exists, updating URL..."
  git remote set-url origin https://github.com/Bandersnatch0x/amber-protocol.git
else
  git remote add origin https://github.com/Bandersnatch0x/amber-protocol.git
fi
echo -e "${GREEN}✓${NC} Remote origin configured"

# Step 3: 推送到 GitHub
echo ""
echo "📤 Step 3: Pushing to GitHub..."
echo ""
read -p "Ready to push code and tag to GitHub? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  git push -u origin master
  git push origin v1.0.0-rc.1
  echo -e "${GREEN}✓${NC} Pushed to GitHub"
  echo ""
  echo "View your repository at:"
  echo "  https://github.com/Bandersnatch0x/amber-protocol"
else
  echo -e "${YELLOW}⚠${NC}  Skipped GitHub push"
  exit 1
fi

# Step 4: npm 登录
echo ""
echo "📝 Step 4: npm Login"
echo ""
echo "You need to login to npm to publish packages."
echo "If you don't have an npm account, create one at: https://www.npmjs.com/signup"
echo ""
read -p "Press ENTER to open npm login prompt..."
npm adduser

# 验证登录
if npm whoami &> /dev/null; then
  NPM_USER=$(npm whoami)
  echo -e "${GREEN}✓${NC} Logged in as: $NPM_USER"
else
  echo -e "${RED}✗${NC} npm login failed"
  exit 1
fi

# Step 5: 发布到 npm
echo ""
echo "📦 Step 5: Publishing to npm..."
echo ""
echo "Package details:"
echo "  Name: amber-protocol"
echo "  Version: 1.0.0-rc.1"
echo "  Tag: rc (not latest)"
echo ""
read -p "Ready to publish to npm? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  npm publish --tag rc
  echo -e "${GREEN}✓${NC} Published to npm"
  echo ""
  echo "View on npm:"
  echo "  https://www.npmjs.com/package/amber-protocol"
else
  echo -e "${YELLOW}⚠${NC}  Skipped npm publish"
  exit 1
fi

# Step 6: 验证发布
echo ""
echo "✅ Step 6: Verifying release..."
echo ""
sleep 2  # 等待 npm 更新
npm view amber-protocol@rc version
echo ""
echo -e "${GREEN}✓${NC} Release verified"

# 成功总结
echo ""
echo "=============================================="
echo "🎉 SUCCESS! v1.0.0-rc.1 Released"
echo "=============================================="
echo ""
echo "Test installation:"
echo "  npm install -g amber-protocol@rc"
echo "  amber --version"
echo ""
echo "GitHub Repository:"
echo "  https://github.com/Bandersnatch0x/amber-protocol"
echo ""
echo "npm Package:"
echo "  https://www.npmjs.com/package/amber-protocol"
echo ""
echo "Next steps:"
echo "  1. Test the RC in oh-my-openagent-dev project"
echo "  2. Document validation results in docs/quality/rc-validation-report.md"
echo "  3. After 1-2 days, proceed to v1.0.0 stable release"
echo ""
