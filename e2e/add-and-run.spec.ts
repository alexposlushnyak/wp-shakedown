import { expect, test } from '@playwright/test';
import { open, useApp } from './harness.ts';

const app = useApp();

test('add a theme, run it twice and compare the runs', async ({ page }) => {
  await open(page, app);
  await expect(page.getByText('No projects yet')).toBeVisible();

  await page.getByRole('button', { name: 'More ways to add' }).click();
  await page.getByRole('menuitem', { name: 'Browse or type a path' }).click();
  await page.getByLabel('Folder').fill(app.alpha);
  await expect(page.getByText('Theme "E2E Alpha"')).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // Adding opens the project. Back on the list it sits under Themes.
  await expect(page.getByRole('heading', { name: 'E2E Alpha' })).toBeVisible();
  await page.getByRole('link', { name: 'Projects', exact: true }).first().click();
  const themes = page.getByRole('region', { name: /Themes/ });
  await expect(themes.getByText('E2E Alpha')).toBeVisible();
  await themes.getByRole('link', { name: /E2E Alpha/ }).click();

  await page.getByRole('combobox', { name: 'Preset' }).click();
  await page.getByRole('option', { name: 'E2E fast' }).click();
  await page.getByRole('button', { name: 'Run the checks' }).click();

  for (const label of ['Critical', 'Important', 'Recommended']) await expect(page.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText(/^Ran .*preset/)).toBeVisible();

  const report = page.getByRole('link', { name: 'Open the report' });
  const href = await report.getAttribute('href');
  const res = await page.request.get(new URL(href!, page.url()).toString());
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/html');

  await page.getByRole('button', { name: 'Run the checks' }).click();
  const history = page.getByRole('button', { name: '2 runs' });
  await expect(history).toBeVisible();
  await history.click();
  const compare = await page.getByRole('link', { name: 'Open the comparison' }).getAttribute('href');
  expect(compare).toContain('/api/report.html');
  expect(compare).toContain('run=');
  expect(compare).toContain('against=');
});
