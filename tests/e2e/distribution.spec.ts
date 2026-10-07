import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { apkHandler, blobSource } from '../../packages/marking/src/index';

const origin = 'http://127.0.0.1:8791';
const adminPath = '/control-e2e';
const password = 'InkParcel-browser-test-2026';

test('admin setup, multi-key upload, personal download and local trace', async ({
  page,
  browser,
}) => {
  const config = JSON.parse(await readFile(resolve('target/e2e-worker.json'), 'utf8'));
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  const screenshotDir = resolve('target/screenshots');
  await mkdir(screenshotDir, { recursive: true });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /欢迎来到/ })).toBeVisible();
  await page.screenshot({ path: resolve(screenshotDir, 'public-desktop.png'), fullPage: true });

  await page.goto('/admin');
  await page.getByLabel(/^初始化令牌/).fill(config.vars.BOOTSTRAP_TOKEN);
  await page.getByLabel('管理员密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByLabel(/^新的管理路径/).fill(adminPath);
  await page.getByRole('button', { name: '完成设置' }).click();
  await expect(page).toHaveURL(`${origin}${adminPath}`);
  await expect(page.getByRole('heading', { name: '文件库', exact: true })).toBeVisible();
  expect((await page.request.get('/admin')).status()).toBe(404);
  expect((await page.request.get('/unknown-page')).status()).toBe(404);

  await page.getByRole('link', { name: '密钥与提取码' }).click();
  await page.getByRole('button', { name: '创建密钥', exact: true }).click();
  await page.getByLabel(/^密钥名称/).fill('Early access');
  await page.getByRole('button', { name: '生成密钥', exact: true }).click();
  await expect(page.getByLabel('新密钥，请安全保存')).toHaveValue(/^[A-Za-z0-9_-]{43}$/);
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '发放提取码' }).click();
  await page.getByLabel(/^领取者用户 ID/).fill('tester@example.test');
  await page.getByRole('button', { name: '生成提取码', exact: true }).click();
  const code = await page.locator('.issued-code code').innerText();
  await page.getByRole('button', { name: '关闭对话框' }).click();
  const second = await page.request.post(`${adminPath}/api/keys`, {
    headers: { Origin: origin },
    data: { name: 'Partners', secret: randomBytes(32).toString('base64url') },
  });
  expect(second.status()).toBe(201);
  const secondKey = (await second.json()).key;

  await page.getByRole('link', { name: '文件库', exact: true }).click();
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByLabel('文件夹名称', { exact: true }).fill('Preview builds');
  await page.getByRole('checkbox', { name: /Early access/ }).check();
  await page.getByRole('button', { name: '保存文件夹' }).click();
  await page.getByRole('button', { name: 'Preview builds', exact: true }).click();
  await page.getByRole('button', { name: '上传文件', exact: true }).click();
  await page
    .getByLabel('选择 APK 文件', { exact: true })
    .setInputFiles(resolve('target/apk-fixtures/large.apk'));
  await expect(page.getByRole('checkbox', { name: /Early access/ })).toBeChecked();
  await page.getByRole('checkbox', { name: /Partners/ }).check();
  await page.getByRole('button', { name: '检查并上传', exact: true }).click();
  await expect(page.getByText('文件已入库', { exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(page.getByRole('button', { name: 'large.apk', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑 large.apk', exact: true }).click();
  await page.getByLabel('显示名称', { exact: true }).fill('Preview 1');
  await page.getByRole('button', { name: '保存更改', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Preview 1', exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotDir, 'admin-library-desktop.png'),
    fullPage: true,
  });

  const recipient = await browser.newContext();
  const publicPage = await recipient.newPage();
  publicPage.on('pageerror', (error) => failures.push(error.message));
  await publicPage.goto(origin);
  await publicPage.getByLabel(/^用户 ID/).fill('tester@example.test');
  await publicPage.getByLabel('专属提取码', { exact: true }).fill(code);
  await publicPage.getByRole('button', { name: '打开我的文件' }).click();
  await publicPage.getByRole('button', { name: 'Preview builds', exact: true }).click();
  await expect(publicPage.getByRole('heading', { name: 'Preview 1', exact: true })).toBeVisible();
  const downloadPromise = publicPage.waitForEvent('download');
  await publicPage.getByRole('button', { name: '领取 Preview 1', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Preview 1.apk');
  const downloadedPath = resolve('target/browser-personalized.apk');
  await download.saveAs(downloadedPath);
  expect(await download.failure()).toBeNull();
  const tools = JSON.parse(await readFile(resolve('target/apk-fixtures/tools.json'), 'utf8'));
  execFileSync(tools.apksigner, ['verify', '--min-sdk-version', '24', downloadedPath], {
    stdio: 'pipe',
  });
  const marker = await apkHandler.extract(blobSource(new Blob([await readFile(downloadedPath)])));
  expect(marker).not.toBeNull();
  const claims = JSON.parse(
    Buffer.from(new TextDecoder().decode(marker!).split('.')[0], 'base64url').toString(),
  );
  expect(claims.userId).not.toBe('tester@example.test');
  expect(claims.name).toBe('Preview 1.apk');

  await page.getByRole('link', { name: '文件溯源', exact: true }).click();
  const traceRequest = page.waitForRequest(
    (request) => request.url().endsWith('/api/trace') && request.method() === 'POST',
  );
  await page.locator('input[type=file]').setInputFiles(downloadedPath);
  // Trace starts automatically after a local file selection.
  const trace = await traceRequest;
  expect(trace.postDataBuffer()?.byteLength ?? Infinity).toBeLessThan(8192);
  expect(Object.keys(trace.postDataJSON()).sort()).toEqual(['fingerprint', 'marker']);
  await expect(page.getByText('tester@example.test', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/内容指纹.*一致|文件内容.*一致|版本一致/).first()).toBeVisible();
  await page.screenshot({
    path: resolve(screenshotDir, 'admin-trace-desktop.png'),
    fullPage: true,
  });

  const records = await page.request.get(`${adminPath}/api/downloads`);
  expect(records.status()).toBe(200);
  const record = (await records.json()).items[0];
  expect(record.userName).toBe('tester@example.test');
  const receiptUrl = `/api/downloads/${record.id}`;
  const fullLength = Number(
    (await publicPage.request.head(origin + receiptUrl)).headers()['content-length'],
  );
  const suffix = await publicPage.request.get(origin + receiptUrl, {
    headers: { Range: 'bytes=-64' },
  });
  expect(suffix.status()).toBe(206);
  expect(suffix.headers()['content-range']).toBe(
    `bytes ${fullLength - 64}-${fullLength - 1}/${fullLength}`,
  );
  expect(suffix.headers()['cache-control']).toBe('private, no-store');
  expect(await suffix.body()).toEqual((await readFile(downloadedPath)).subarray(-64));

  await page.getByRole('link', { name: '用户', exact: true }).click();
  await page.getByRole('button', { name: '编辑 tester@example.test 的备注', exact: true }).click();
  await page.getByLabel(/^备注/).fill('Generic browser fixture\nSecond line');
  await page.getByRole('button', { name: '保存备注', exact: true }).click();
  await expect(
    page.getByText('Generic browser fixture Second line', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '查看 tester@example.test 的领取记录', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Preview 1.apk', exact: true })).toBeVisible();

  // An existing user receives a separate key session without inheriting history.
  const isolatedKey = await page.request.post(`${adminPath}/api/keys`, {
    headers: { Origin: origin },
    data: { name: 'Unassigned' },
  });
  const isolated = (await isolatedKey.json()).key;
  const alternateCodeResponse = await page.request.post(
    `${adminPath}/api/keys/${isolated.id}/code`,
    {
      headers: { Origin: origin },
      data: { userId: 'tester@example.test' },
    },
  );
  const alternateCode = (await alternateCodeResponse.json()).code;
  const isolatedContext = await browser.newContext();
  const alternate = await isolatedContext.request.post(origin + '/api/access', {
    headers: { Origin: origin },
    data: { userId: 'tester@example.test', code: alternateCode },
  });
  expect(alternate.status()).toBe(200);
  const hidden = await isolatedContext.request.get(origin + '/api/files');
  expect(await hidden.json()).toMatchObject({ files: [], folders: [] });
  expect((await isolatedContext.request.get(origin + receiptUrl)).status()).toBe(404);
  expect((await page.request.get(`${adminPath}/api/users`)).ok()).toBeTruthy();

  await page.request.patch(`${adminPath}/api/keys/${claims.keyId}`, {
    headers: { Origin: origin },
    data: { enabled: false },
  });
  const revoked = await publicPage.request.get(origin + receiptUrl);
  expect(revoked.status()).toBe(401);
  expect(await revoked.json()).toMatchObject({ error: { code: 'access_revoked' } });
  const oldTrace = await page.request.post(`${adminPath}/api/trace`, {
    headers: { Origin: origin },
    data: trace.postDataJSON(),
  });
  expect(oldTrace.status()).toBe(200);
  expect(await oldTrace.json()).toMatchObject({ authentic: true, contentMatch: true });
  expect(secondKey.name).toBe('Partners');

  // Resume from server state even after local browser upload metadata is gone.
  const original = await readFile(resolve('target/apk-fixtures/large.apk'));
  const pendingResponse = await page.request.post(`${adminPath}/api/uploads`, {
    headers: { Origin: origin },
    data: {
      fileName: 'Interrupted.apk',
      size: original.length,
      keyIds: [secondKey.id],
      fingerprint: claims.fingerprint,
    },
  });
  expect(pendingResponse.status()).toBe(201);
  const pendingUpload = await pendingResponse.json();
  const firstPart = await page.request.put(
    `${adminPath}/api/uploads/${pendingUpload.fileId}/parts/1`,
    {
      headers: { Origin: origin, 'Content-Type': 'application/octet-stream' },
      data: original.subarray(0, pendingUpload.partSize),
    },
  );
  expect(firstPart.status()).toBe(200);
  await page.evaluate(() => localStorage.clear());
  let releaseSession!: () => void;
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  const sessionRoute = `**/api/uploads/${pendingUpload.fileId}`;
  await page.route(sessionRoute, async (route) => {
    await sessionGate;
    await route.continue();
  });
  await page.getByRole('link', { name: '文件库', exact: true }).click();
  await page.getByRole('button', { name: '继续上传 Interrupted.apk', exact: true }).click();
  await expect(page.getByLabel('选择 APK 文件', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '检查并上传', exact: true })).toBeDisabled();
  releaseSession();
  await expect(page.getByText(/正在恢复“Interrupted.apk”/)).toBeVisible();
  await page.unroute(sessionRoute);
  await page
    .getByLabel('选择 APK 文件', { exact: true })
    .setInputFiles(resolve('target/apk-fixtures/large.apk'));
  const resumedParts: number[] = [];
  page.on('request', (request) => {
    const match = request.url().match(new RegExp(`/uploads/${pendingUpload.fileId}/parts/(\\d+)$`));
    if (match && request.method() === 'PUT') resumedParts.push(Number(match[1]));
  });
  await page.getByRole('button', { name: '检查并上传', exact: true }).click();
  await expect(page.getByText('文件已入库', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  expect(resumedParts).toEqual([2, 3]);
  await expect(page.getByRole('button', { name: 'Interrupted.apk', exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('link', { name: '文件库', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文件库', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({
    path: resolve(screenshotDir, 'admin-library-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(origin);
  await expect(mobile.getByRole('heading', { name: /欢迎来到/ })).toBeVisible();
  await mobile.screenshot({ path: resolve(screenshotDir, 'public-mobile.png'), fullPage: true });
  expect(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('link', { name: '站点设置', exact: true }).click();
  await page.getByLabel('站点名称', { exact: true }).fill('InkParcel Preview');
  await page.getByLabel(/^IP 地址保留天数/).fill('0');
  await page.getByLabel(/^管理入口/).fill('/control-renamed');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/control-renamed#settings`);
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('InkParcel Preview');
  expect((await page.request.get(adminPath)).status()).toBe(404);
  expect((await page.request.get(`${adminPath}/api/keys`)).status()).toBe(404);
  await page.getByLabel('当前密码', { exact: true }).fill(password);
  const updatedPassword = 'InkParcel-updated-browser-password';
  await page.getByLabel('新密码', { exact: true }).fill(updatedPassword);
  await page.getByLabel('确认新密码', { exact: true }).fill(updatedPassword);
  await page.getByRole('button', { name: '更新密码并重新登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await page.getByLabel('管理员密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录管理后台', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('密码错误');
  await page.getByLabel('管理员密码', { exact: true }).fill(updatedPassword);
  await page.getByRole('button', { name: '登录管理后台', exact: true }).click();
  await expect(page.getByRole('heading', { name: '文件库', exact: true })).toBeVisible();
  expect(failures).toEqual([]);
  await mobile.close();
  await recipient.close();
  await isolatedContext.close();
});
