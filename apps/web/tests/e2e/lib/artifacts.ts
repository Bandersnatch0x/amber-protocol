import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export const artifactDir = path.resolve(process.cwd(), '..', '..', 'output', 'playwright');

export async function capture(page: Page, name: string): Promise<void> {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({
    path: path.join(artifactDir, name),
    fullPage: true,
    animations: 'disabled',
  });
}
