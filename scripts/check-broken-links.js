"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS_DIR = path.join(ROOT, "docs");

/**
 * 递归收集目录下所有 markdown 文件
 */
function collectMarkdownFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * 从 markdown 内容中提取链接（跳过代码块）
 */
function extractLinks(content) {
  // 移除代码块（``` 包围的内容）
  const contentWithoutCodeBlocks = content.replace(/```[\s\S]*?```/g, '');

  // 移除行内代码（` 包围的内容）
  const contentWithoutInlineCode = contentWithoutCodeBlocks.replace(/`[^`]+`/g, '');

  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let match;

  while ((match = linkRegex.exec(contentWithoutInlineCode)) !== null) {
    const url = match[2];
    // 只检查相对路径链接，跳过 http/https 和锚点
    if (!url.startsWith("http") && !url.startsWith("#")) {
      links.push(url);
    }
  }

  return links;
}

/**
 * 验证链接目标文件是否存在
 */
function validateLink(linkPath, sourceFile) {
  // 移除查询字符串和锚点
  const cleanPath = linkPath.split(/[?#]/)[0];

  // 解析相对路径
  const sourceDir = path.dirname(sourceFile);
  const targetPath = path.resolve(sourceDir, cleanPath);

  return fs.existsSync(targetPath);
}

// 主逻辑
const files = collectMarkdownFiles(DOCS_DIR);
let brokenCount = 0;

console.log(`🔍 Checking ${files.length} markdown files...\n`);

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const links = extractLinks(content);

  for (const link of links) {
    if (!validateLink(link, file)) {
      console.error(`❌ Broken link in ${path.relative(ROOT, file)}: ${link}`);
      brokenCount++;
    }
  }
}

if (brokenCount > 0) {
  console.error(`\n❌ Found ${brokenCount} broken link(s)`);
  process.exit(1);
} else {
  console.log("✅ All links valid");
}
