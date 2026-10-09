import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { apkHandler, blobSource } from '../../packages/marking/src/index';

const origin = 'http://127.0.0.1:8791';
const cdnOrigin = 'http://localhost:8793';
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
  await page.getByRole('link', { name: '站点设置', exact: true }).click();
  await page.getByRole('button', { name: '添加下载源', exact: true }).click();
  await page.getByLabel('线路名称 1', { exact: true }).fill('Direct');
  await page.getByLabel('线路地址 1', { exact: true }).fill(origin);
  await page.getByRole('button', { name: '添加下载源', exact: true }).click();
  await page.getByLabel('线路名称 2', { exact: true }).fill('CDN');
  await page.getByLabel('线路地址 2', { exact: true }).fill(cdnOrigin);
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByText('站点设置已保存。', { exact: true })).toBeVisible();
  const publicPage = await recipient.newPage();
  publicPage.on('pageerror', (error) => failures.push(error.message));
  await publicPage.goto(origin);
  await publicPage.getByLabel(/^用户 ID/).fill('tester@example.test');
  await publicPage.getByLabel('专属提取码', { exact: true }).fill(code);
  await publicPage.getByRole('button', { name: '打开我的文件' }).click();
  await publicPage.getByRole('button', { name: 'Preview builds', exact: true }).click();
  await expect(publicPage.getByRole('heading', { name: 'Preview 1', exact: true })).toBeVisible();
  await publicPage.getByRole('button', { name: '领取 Preview 1', exact: true }).click();
  await expect(publicPage.getByRole('dialog', { name: '选择下载源' })).toBeVisible();
  await expect(publicPage.getByRole('dialog')).toContainText(cdnOrigin);
  expect((await (await page.request.get(`${adminPath}/api/downloads`)).json()).total).toBe(0);
  await publicPage.getByRole('button', { name: '取消', exact: true }).click();
  await publicPage.getByRole('button', { name: '领取 Preview 1', exact: true }).click();
  await expect(publicPage.getByRole('radio', { name: /Direct/ })).toBeChecked();
  const downloadPromise = publicPage.waitForEvent('download');
  await publicPage.getByRole('button', { name: '开始下载', exact: true }).click();
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
  await page.getByLabel('选择待溯源文件', { exact: true }).setInputFiles(downloadedPath);
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

  // Presentation can be simplified without changing recipient authorization or trace behavior.
  await page.getByRole('link', { name: '站点设置', exact: true }).click();
  await page.getByRole('checkbox', { name: /隐匿模式/ }).check();
  await page.getByRole('checkbox', { name: /显示下载源域名/ }).uncheck();
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByText('站点设置已保存。', { exact: true })).toBeVisible();
  const simpleContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const simplePage = await simpleContext.newPage();
  await simplePage.goto(origin);
  await expect(simplePage.getByRole('heading', { name: '提取文件', exact: true })).toBeVisible();
  await expect(simplePage).toHaveTitle('文件分享');
  await expect(simplePage.locator('body')).not.toContainText(
    /溯源|标记|印记|InkParcel|可验证|来处可循/,
  );
  await simplePage.screenshot({
    path: resolve(screenshotDir, 'simple-access-mobile.png'),
    fullPage: true,
  });
  await simplePage.getByLabel('语言 / Language', { exact: true }).selectOption('en');
  await expect(
    simplePage.getByRole('heading', { name: 'Retrieve files', exact: true }),
  ).toBeVisible();
  await simplePage.reload();
  await expect(simplePage.locator('html')).toHaveAttribute('lang', 'en');
  await expect(simplePage).toHaveTitle('File sharing');
  await simplePage.screenshot({
    path: resolve(screenshotDir, 'access-english-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await simplePage.getByLabel(/^User ID/).fill('tester@example.test');
  await simplePage.getByLabel('Access code', { exact: true }).fill('invalid-code');
  await simplePage.getByRole('button', { name: 'Retrieve files', exact: true }).click();
  await expect(simplePage.getByRole('alert')).toHaveText('Incorrect user ID or access code');
  await simplePage.getByLabel('语言 / Language', { exact: true }).selectOption('zh-CN');
  await expect(simplePage.getByRole('alert')).toHaveText('用户 ID 或提取码错误');
  await simplePage.getByLabel(/^用户 ID/).fill('tester@example.test');
  await simplePage.getByLabel('提取码', { exact: true }).fill(code);
  await simplePage.getByRole('button', { name: '提取文件', exact: true }).click();
  await simplePage.getByRole('button', { name: 'Preview builds', exact: true }).click();
  await expect(
    simplePage.getByRole('button', { name: '下载 Preview 1', exact: true }),
  ).toBeVisible();
  await expect(simplePage.locator('body')).not.toContainText(
    /溯源|标记|印记|InkParcel|Early access/,
  );
  expect(
    await simplePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await simplePage.screenshot({
    path: resolve(screenshotDir, 'simple-library-mobile.png'),
    fullPage: true,
  });
  // The alternate host has no recipient cookie; its download uses only a scoped grant.
  expect((await simpleContext.request.get(cdnOrigin + '/api/session')).status()).toBe(401);
  await simplePage.getByRole('button', { name: '下载 Preview 1', exact: true }).click();
  await simplePage.getByRole('radio', { name: /CDN/ }).check();
  const sourceDialog = simplePage.getByRole('dialog');
  await expect(sourceDialog).not.toContainText(cdnOrigin);
  await expect(sourceDialog).not.toContainText(origin);
  await expect(simplePage.getByRole('radio', { name: 'CDN', exact: true })).toBeChecked();
  await sourceDialog.getByLabel('语言 / Language', { exact: true }).selectOption('en');
  await expect(sourceDialog).toHaveAccessibleName('Choose a download source');
  await expect(simplePage.getByRole('radio', { name: /CDN/ })).toBeChecked();
  expect(
    await simplePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await simplePage.screenshot({
    path: resolve(screenshotDir, 'download-sources-mobile.png'),
    fullPage: true,
  });
  const cdnDownloadPromise = simplePage.waitForEvent('download');
  await simplePage.getByRole('button', { name: 'Start download', exact: true }).click();
  const cdnDownload = await cdnDownloadPromise;
  expect(new URL(cdnDownload.url()).origin).toBe(cdnOrigin);
  const cdnPath = resolve('target/browser-cdn.apk');
  await cdnDownload.saveAs(cdnPath);
  expect(await cdnDownload.failure()).toBeNull();
  execFileSync(tools.apksigner, ['verify', '--min-sdk-version', '24', cdnPath], { stdio: 'pipe' });
  const cdnBytes = await readFile(cdnPath);
  const rangeResponse = await simpleContext.request.get(cdnDownload.url(), {
    headers: { Range: 'bytes=-64' },
  });
  expect(rangeResponse.status()).toBe(206);
  expect(rangeResponse.headers()['cache-control']).toBe('private, no-store');
  expect(await rangeResponse.body()).toEqual(cdnBytes.subarray(-64));
  expect((await simpleContext.request.get(cdnOrigin + '/api/session')).status()).toBe(401);
  const cdnPage = await simpleContext.newPage();
  await cdnPage.goto(cdnOrigin);
  await cdnPage.getByLabel(/^用户 ID/).fill('tester@example.test');
  await cdnPage.getByLabel('提取码', { exact: true }).fill(code);
  await cdnPage.getByRole('button', { name: '提取文件', exact: true }).click();
  await cdnPage.getByRole('button', { name: 'Preview builds', exact: true }).click();
  await expect(cdnPage.getByRole('button', { name: '下载 Preview 1', exact: true })).toBeVisible();
  await cdnPage.close();
  await simplePage.getByLabel('语言 / Language', { exact: true }).selectOption('zh-CN');
  await simplePage.getByRole('button', { name: '退出', exact: true }).click();
  await expect(simplePage.getByRole('heading', { name: '提取文件', exact: true })).toBeVisible();
  await simpleContext.close();
  await page.getByRole('checkbox', { name: /隐匿模式/ }).uncheck();
  await page.getByRole('checkbox', { name: /显示下载源域名/ }).check();
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page.getByText('站点设置已保存。', { exact: true })).toBeVisible();
  await publicPage.reload();
  await expect(
    publicPage.getByText('下载文件将写入与你的领取记录关联的专属标记。', { exact: true }),
  ).toBeVisible();

  const records = await page.request.get(`${adminPath}/api/downloads`);
  expect(records.status()).toBe(200);
  const record = (await records.json()).items.find(
    (item: { id: string }) => item.id === claims.issuanceId,
  );
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
  await expect(page.getByRole('button', { name: 'Preview 1.apk', exact: true })).toHaveCount(2);

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
  await page.getByLabel('站点名称', { exact: true }).fill('示例文件站');
  await page.getByLabel(/^IP 地址保留天数/).fill('0');
  await page.getByLabel(/^管理入口/).fill('manage');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '保存站点设置', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/manage#settings`);
  await expect(page.getByLabel('站点名称', { exact: true })).toHaveValue('示例文件站');
  await expect(page).toHaveTitle('示例文件站');
  await expect(page.locator('body')).not.toContainText('InkParcel');
  await page
    .getByLabel('上传网站图标', { exact: true })
    .setInputFiles(resolve('tests/fixtures/site-icon.png'));
  await expect(page.getByRole('button', { name: '清除图标', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar .brand-custom-icon')).toBeVisible();
  await expect(page.locator('.sidebar .brand-symbol')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.locator('.sidebar').evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  const customIcon = page.locator('.mobile-header .brand-custom-icon');
  await expect(customIcon).toBeVisible();
  const appearance = await customIcon.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      transform: style.transform,
      width: element.getBoundingClientRect().width,
    };
  });
  expect(appearance.background).toBe('rgba(0, 0, 0, 0)');
  expect(appearance.transform).toBe('none');
  expect(appearance.width).toBe(34);
  await page.screenshot({ path: resolve(screenshotDir, 'custom-icon-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const iconHref = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(iconHref).toContain('/api/site-icon?v=');
  const iconResponse = await page.request.get(iconHref!);
  expect(iconResponse.headers()['content-type']).toBe('image/png');
  expect(await iconResponse.body()).toEqual(
    await readFile(resolve('tests/fixtures/site-icon.png')),
  );
  await publicPage.goto(origin);
  await expect(publicPage).toHaveTitle('示例文件站');
  await expect(publicPage.locator('body')).not.toContainText('InkParcel');
  await expect(publicPage.locator('.brand img').first()).toHaveAttribute('src', iconHref!);
  await page.getByRole('button', { name: '清除图标', exact: true }).click();
  await expect(page.getByRole('button', { name: '清除图标', exact: true })).toHaveCount(0);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/api/site-icon');
  await expect(page.locator('.sidebar .brand-custom-icon')).toHaveCount(0);
  await expect(page.locator('.sidebar .brand-symbol svg')).toBeVisible();
  await expect(page.getByText('未设置自定义图标', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: resolve(screenshotDir, 'cleared-icon-mobile.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1280, height: 900 });

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
  await page.getByRole('link', { name: '密钥与提取码', exact: true }).click();
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: '删除 Early access', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除 Early access', exact: true })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除 Early access', exact: true }).click();
  await expect(page.getByRole('button', { name: '删除 Early access', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '用户', exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除 tester@example.test', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '删除 tester@example.test', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: '文件溯源', exact: true }).click();
  await page.getByLabel('选择待溯源文件', { exact: true }).setInputFiles(downloadedPath);
  await expect(page.getByText('tester@example.test', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/文件内容.*一致/).first()).toBeVisible();
  await page.getByLabel('语言 / Language', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Trace a file', exact: true })).toBeVisible();
  await expect(
    page.getByText('File content matches the issued version', { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('示例文件站');
  await page.getByRole('link', { name: 'Site settings', exact: true }).click();
  await expect(page.getByLabel('Site name', { exact: true })).toHaveValue('示例文件站');
  await page.screenshot({
    path: resolve(screenshotDir, 'settings-english.png'),
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Keys and access codes', exact: true }).click();
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('Disable');
    await dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Disable Partners', exact: true }).click();
  await page.getByRole('button', { name: 'Rename Partners', exact: true }).click();
  await page.getByLabel('Key name', { exact: true }).fill('Draft 中文');
  await page
    .getByRole('dialog')
    .getByLabel('语言 / Language', { exact: true })
    .selectOption('zh-CN');
  await expect(page.getByLabel('密钥名称', { exact: true })).toHaveValue('Draft 中文');
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  expect(failures).toEqual([]);
  await mobile.close();
  await recipient.close();
  await isolatedContext.close();
});
