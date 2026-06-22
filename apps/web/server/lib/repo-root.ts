import fs from 'fs';
import path from 'path';

function isAmberRepoRoot(candidate: string): boolean {
  if (!fs.existsSync(path.join(candidate, 'routes'))) {
    return false;
  }

  const packagePath = path.join(candidate, 'package.json');
  if (!fs.existsSync(packagePath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageJson.name === 'amber-protocol';
  } catch {
    return false;
  }
}

export function resolveRepoRoot(startDir = process.cwd()): string {
  const envRoot = process.env.AMBER_REPO_ROOT;
  if (envRoot) {
    return path.resolve(envRoot);
  }

  let current = path.resolve(startDir);
  while (true) {
    if (isAmberRepoRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir, '..', '..');
    }
    current = parent;
  }
}
