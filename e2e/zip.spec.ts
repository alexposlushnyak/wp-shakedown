import { expect, test } from '@playwright/test';
import { open, useApp } from './harness.ts';

const app = useApp();

test('upload a ZIP of a theme', async ({ page }) => {
  await open(page, app);
  await page.locator('input[type="file"]').setInputFiles(app.zip);
  await expect(page.getByText('Added E2E Gamma.')).toBeVisible();
  await expect(page.getByRole('region', { name: /Themes/ }).getByText('E2E Gamma')).toBeVisible();
  // The upload queues a run. It ends with a result in the list.
  await expect(page.getByRole('link', { name: /E2E Gamma.*(Clean|critical|important)/ })).toBeVisible();
});
