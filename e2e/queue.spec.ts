import { expect, test } from '@playwright/test';
import { open, useApp } from './harness.ts';

const app = useApp();

test('run three themes at once', async ({ page }) => {
  await open(page, app);
  for (const dir of [app.alpha, app.beta]) {
    await page.getByRole('button', { name: 'More ways to add' }).click();
    await page.getByRole('menuitem', { name: 'Browse or type a path' }).click();
    await page.getByLabel('Folder').fill(dir);
    await expect(page.getByText(/^Theme "E2E /)).toBeVisible();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
  }
  // Upload runs the ZIP at once, so wait for it to finish before the batch.
  await page.locator('input[type="file"]').setInputFiles(app.zip);
  await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
  const done = (name: string) => page.getByRole('link', { name: new RegExp(`${name}.*(Clean|critical|important)`) });
  await expect(done('E2E Gamma')).toBeVisible();

  await page.getByRole('button', { name: 'Run all' }).click();
  await expect(page.getByRole('status')).toHaveText('Idle');
  for (const name of ['E2E Alpha', 'E2E Beta', 'E2E Gamma']) await expect(done(name)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run all' })).toBeEnabled();
});
