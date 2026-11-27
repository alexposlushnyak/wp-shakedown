import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { open, useApp } from './harness.ts';

const app = useApp();

// The list groups carry no landmark name, so go from the heading to its section.
const group = (page: Page, name: RegExp) => page.getByRole('heading', { name }).locator('xpath=..');

test('copy a built-in preset, change its level, save and delete it', async ({ page }) => {
  await open(page, app);
  await page.getByRole('button', { name: 'Presets' }).click();
  await expect(page.getByRole('heading', { name: 'Presets' })).toBeVisible();

  // The first built-in preset.
  await group(page, /^Built in/).getByRole('link').first().click();
  await page.getByRole('link', { name: 'Copy to a new preset' }).click();
  await expect(page.getByRole('heading', { name: 'New preset' })).toBeVisible();
  const title = await page.getByLabel('Title').inputValue();
  expect(title).toMatch(/ copy$/);

  const slider = page.getByRole('slider');
  await slider.focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await page.getByRole('button', { name: 'Save the preset' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Presets' }).click();
  const yours = group(page, /^Yours/);
  await expect(yours.getByRole('link', { name: new RegExp(`${title}.*Level 2`) })).toBeVisible();

  await yours.getByRole('link', { name: new RegExp(title) }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(group(page, /^Yours/).getByText(title)).toHaveCount(0);
});
