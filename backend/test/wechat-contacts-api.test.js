import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createApp } from "../src/app/createApp.js";
import { initDatabase } from "../src/db/database.js";
import { nowIso } from "../src/db/sql.js";
import { query, run } from "../src/db/client.js";
import { env } from "../src/config/env.js";
import { createPassword, signJwt } from "../src/lib/crypto.js";
import adminRoutes from "../src/routes/admin.js";
import adminWechatContactsRoutes from "../src/routes/adminWechatContacts.js";
import {
  createMfaSetupPayload,
  encryptMfaSecret,
  generateTotpCode,
} from "../src/services/mfaService.js";

const makeBaseUrl = (server) => {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server address unavailable");
  }
  return `http://127.0.0.1:${address.port}`;
};

const createAppServer = async () => {
  const { app } = createApp();
  const server = await new Promise((resolve, reject) => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
  return server;
};

const createAdminServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/admin", adminRoutes);
  app.use("/api/v1/admin", adminWechatContactsRoutes);
  const server = await new Promise((resolve, reject) => {
    const next = app.listen(0, "127.0.0.1", () => resolve(next));
    next.on("error", reject);
  });
  return server;
};

const insertWechatContact = ({
  id,
  slug,
  title = "测试联系人",
  subtitle = null,
  contactType = "landing_qr",
  targetUrl = null,
  wechatId = null,
  qrImageDataUrl = null,
  showInPricing = true,
  isActive = true,
  sortOrder = 100,
  createdBy = null,
  updatedBy = null,
}) => {
  const ts = nowIso();
  run(
    `INSERT INTO wechat_contacts (
      id, slug, title, subtitle, contact_type, target_url, wechat_id, qr_image_data_url,
      show_in_pricing, is_active, sort_order, created_by, updated_by, created_at, updated_at
    ) VALUES (
      $id, $slug, $title, $subtitle, $contactType, $targetUrl, $wechatId, $qrImageDataUrl,
      $showInPricing, $isActive, $sortOrder, $createdBy, $updatedBy, $createdAt, $updatedAt
    )`,
    {
      $id: id,
      $slug: slug,
      $title: title,
      $subtitle: subtitle,
      $contactType: contactType,
      $targetUrl: targetUrl,
      $wechatId: wechatId,
      $qrImageDataUrl: qrImageDataUrl,
      $showInPricing: showInPricing ? 1 : 0,
      $isActive: isActive ? 1 : 0,
      $sortOrder: sortOrder,
      $createdBy: createdBy,
      $updatedBy: updatedBy,
      $createdAt: ts,
      $updatedAt: ts,
    },
  );
};

const insertAdminUser = ({ id, username, password }) => {
  const ts = nowIso();
  const passwordMeta = createPassword(password);
  const mfaSetup = createMfaSetupPayload({ username });
  run(
    `INSERT INTO users (
      id, username, email, password_salt, password_hash, token_version, is_admin,
      mfa_enabled, mfa_totp_secret_enc, mfa_recovery_codes_hash, created_at, updated_at
    ) VALUES (
      $id, $username, NULL, $salt, $hash, 0, 1,
      1, $secretEnc, $recoveryHash, $createdAt, $updatedAt
    )`,
    {
      $id: id,
      $username: username,
      $salt: passwordMeta.salt,
      $hash: passwordMeta.hash,
      $secretEnc: encryptMfaSecret(mfaSetup.secret),
      $recoveryHash: JSON.stringify(mfaSetup.recoveryCodeHashes),
      $createdAt: ts,
      $updatedAt: ts,
    },
  );
  return mfaSetup;
};

const authHeaders = ({ userId, username }) => {
  const token = signJwt({ sub: userId, username, ver: 0 }, 60 * 10);
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
};

const fetchAdminConfirmToken = async ({ baseUrl, adminUser, secret }) => {
  const response = await fetch(`${baseUrl}/api/v1/admin/confirm-password`, {
    method: "POST",
    headers: authHeaders({ userId: adminUser.id, username: adminUser.username }),
    body: JSON.stringify({
      totpCode: generateTotpCode({ secret }),
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  return String(payload?.data?.token || "");
};

const clearAdminWechatContactsWriteRateLimit = () => {
  run(`DELETE FROM security_rate_limits WHERE scope_key LIKE 'admin_wechat_contacts_write:%'`);
};

test("GET /api/v1/public/wechat-contacts only returns active + showInPricing rows and detail hides inactive rows", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slugSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const visibleId = `wechat_visible_${suffix}`;
  const hiddenId = `wechat_hidden_${suffix}`;
  const inactiveId = `wechat_inactive_${suffix}`;
  const visibleSlug = `visible-${slugSuffix}`;
  const hiddenSlug = `hidden-${slugSuffix}`;
  const inactiveSlug = `inactive-${slugSuffix}`;
  const missingSlug = `wechat-missing-${slugSuffix}`;

  run(`DELETE FROM wechat_contacts WHERE id IN ($visibleId, $hiddenId, $inactiveId)`, {
    $visibleId: visibleId,
    $hiddenId: hiddenId,
    $inactiveId: inactiveId,
  });

  insertWechatContact({
    id: visibleId,
    slug: visibleSlug,
    title: "公开可见联系人",
    subtitle: "价格菜单展示",
    contactType: "landing_qr",
    wechatId: "visible-wechat",
    qrImageDataUrl: "data:image/png;base64,QUJDREVGRw==",
    showInPricing: true,
    isActive: true,
    sortOrder: 1,
  });
  insertWechatContact({
    id: hiddenId,
    slug: hiddenSlug,
    title: "隐藏联系人",
    contactType: "external_url",
    targetUrl: "https://example.com/hidden",
    showInPricing: false,
    isActive: true,
    sortOrder: 2,
  });
  insertWechatContact({
    id: inactiveId,
    slug: inactiveSlug,
    title: "停用联系人",
    contactType: "external_url",
    targetUrl: "https://example.com/inactive",
    showInPricing: true,
    isActive: false,
    sortOrder: 3,
  });

  const server = await createAppServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    run(`DELETE FROM wechat_contacts WHERE id IN ($visibleId, $hiddenId, $inactiveId)`, {
      $visibleId: visibleId,
      $hiddenId: hiddenId,
      $inactiveId: inactiveId,
    });
  });

  const baseUrl = makeBaseUrl(server);

  const listRes = await fetch(`${baseUrl}/api/v1/public/wechat-contacts`);
  assert.equal(listRes.status, 200);
  const listPayload = await listRes.json();
  const list = Array.isArray(listPayload?.data) ? listPayload.data : [];
  assert.equal(list.length, 1);
  assert.equal(list[0]?.slug, visibleSlug);
  assert.equal("qrImageDataUrl" in list[0], false);

  const visibleDetailRes = await fetch(`${baseUrl}/api/v1/public/wechat-contacts/${encodeURIComponent(visibleSlug)}`);
  assert.equal(visibleDetailRes.status, 200);

  const hiddenDetailRes = await fetch(`${baseUrl}/api/v1/public/wechat-contacts/${encodeURIComponent(hiddenSlug)}`);
  assert.equal(hiddenDetailRes.status, 404);

  const inactiveDetailRes = await fetch(`${baseUrl}/api/v1/public/wechat-contacts/${encodeURIComponent(inactiveSlug)}`);
  assert.equal(inactiveDetailRes.status, 404);

  const missingDetailRes = await fetch(`${baseUrl}/api/v1/public/wechat-contacts/${encodeURIComponent(missingSlug)}`);
  assert.equal(missingDetailRes.status, 404);
});

test("POST /api/v1/admin/wechat-contacts rejects javascript URL", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slugSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminUser = {
    id: `wechat_admin_${suffix}`,
    username: `wechat_admin_${suffix}`,
    password: "Admin1234!Aa",
  };

  run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  const mfaSetup = insertAdminUser(adminUser);
  clearAdminWechatContactsWriteRateLimit();

  const server = await createAdminServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearAdminWechatContactsWriteRateLimit();
    run(`DELETE FROM wechat_contacts WHERE created_by = $adminId OR updated_by = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  });

  const baseUrl = makeBaseUrl(server);
  const confirmToken = await fetchAdminConfirmToken({
    baseUrl,
    adminUser,
    secret: mfaSetup.secret,
  });

  const response = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts`, {
    method: "POST",
    headers: {
      ...authHeaders({ userId: adminUser.id, username: adminUser.username }),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({
      slug: `external-${slugSuffix}`,
      title: "外部联系",
      subtitle: "",
      contactType: "external_url",
      targetUrl: "javascript:alert(1)",
      wechatId: "",
      qrImageDataUrl: "",
      showInPricing: true,
      isActive: true,
      sortOrder: 10,
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(String(payload?.message || ""), /https/);
});

test("POST /api/v1/admin/wechat-contacts rejects invalid QR data url", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slugSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminUser = {
    id: `wechat_admin_qr_${suffix}`,
    username: `wechat_admin_qr_${suffix}`,
    password: "Admin1234!Aa",
  };

  run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  const mfaSetup = insertAdminUser(adminUser);
  clearAdminWechatContactsWriteRateLimit();

  const server = await createAdminServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearAdminWechatContactsWriteRateLimit();
    run(`DELETE FROM wechat_contacts WHERE created_by = $adminId OR updated_by = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  });

  const baseUrl = makeBaseUrl(server);
  const confirmToken = await fetchAdminConfirmToken({
    baseUrl,
    adminUser,
    secret: mfaSetup.secret,
  });

  const response = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts`, {
    method: "POST",
    headers: {
      ...authHeaders({ userId: adminUser.id, username: adminUser.username }),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({
      slug: `landing-${slugSuffix}`,
      title: "二维码联系",
      subtitle: "",
      contactType: "landing_qr",
      targetUrl: "",
      wechatId: "wx-landing",
      qrImageDataUrl: "data:image/gif;base64,AAAA",
      showInPricing: true,
      isActive: true,
      sortOrder: 5,
    }),
  });

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(String(payload?.message || ""), /data url/);
});

test("POST /api/v1/admin/wechat-contacts accepts work.weixin.qq.com/kfid url and PUT can update flags", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slugSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminUser = {
    id: `wechat_admin_ok_${suffix}`,
    username: `wechat_admin_ok_${suffix}`,
    password: "Admin1234!Aa",
  };

  run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  const mfaSetup = insertAdminUser(adminUser);
  clearAdminWechatContactsWriteRateLimit();

  const server = await createAdminServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearAdminWechatContactsWriteRateLimit();
    run(`DELETE FROM wechat_contacts WHERE created_by = $adminId OR updated_by = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  });

  const baseUrl = makeBaseUrl(server);
  const confirmToken = await fetchAdminConfirmToken({
    baseUrl,
    adminUser,
    secret: mfaSetup.secret,
  });
  const createResponse = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts`, {
    method: "POST",
    headers: {
      ...authHeaders({ userId: adminUser.id, username: adminUser.username }),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({
      slug: `wecom-${slugSuffix}`,
      title: "企业微信客服",
      subtitle: "自动跳转",
      contactType: "wecom_kf_link",
      targetUrl: "https://work.weixin.qq.com/kfid/kfc1234567890",
      wechatId: "",
      qrImageDataUrl: "",
      showInPricing: true,
      isActive: true,
      sortOrder: 8,
    }),
  });

  assert.equal(createResponse.status, 200);
  const createPayload = await createResponse.json();
  assert.equal(createPayload?.data?.contactType, "wecom_kf_link");
  assert.equal(createPayload?.data?.targetUrl, "https://work.weixin.qq.com/kfid/kfc1234567890");
  const createdId = String(createPayload?.data?.id || "");
  assert.ok(createdId);

  const updateResponse = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts/${createdId}`, {
    method: "PUT",
    headers: {
      ...authHeaders({ userId: adminUser.id, username: adminUser.username }),
      "x-admin-confirm-token": confirmToken,
    },
    body: JSON.stringify({
      showInPricing: false,
      isActive: false,
      sortOrder: 88,
    }),
  });

  assert.equal(updateResponse.status, 200);
  const stored = query(
    `SELECT
      show_in_pricing as showInPricing,
      is_active as isActive,
      sort_order as sortOrder
     FROM wechat_contacts
     WHERE id = $id`,
    { $id: createdId },
  )[0];
  assert.equal(Number(stored?.showInPricing), 0);
  assert.equal(Number(stored?.isActive), 0);
  assert.equal(Number(stored?.sortOrder), 88);
});

test("admin wechat contact writes require sensitive confirmation for POST PUT DELETE", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slugSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminUser = {
    id: `wechat_admin_guard_${suffix}`,
    username: `wechat_admin_guard_${suffix}`,
    password: "Admin1234!Aa",
  };
  const existingContactId = `wechat_guard_existing_${suffix}`;

  run(`DELETE FROM wechat_contacts WHERE id = $id`, { $id: existingContactId });
  run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  insertAdminUser(adminUser);
  insertWechatContact({
    id: existingContactId,
    slug: `guard-${slugSuffix}`,
    title: "待更新联系人",
    contactType: "landing_qr",
    wechatId: "guard-wx",
    qrImageDataUrl: "data:image/png;base64,QUJDREVGRw==",
    createdBy: adminUser.id,
    updatedBy: adminUser.id,
  });
  clearAdminWechatContactsWriteRateLimit();

  const server = await createAdminServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearAdminWechatContactsWriteRateLimit();
    run(`DELETE FROM wechat_contacts WHERE id = $id`, { $id: existingContactId });
    run(`DELETE FROM wechat_contacts WHERE created_by = $adminId OR updated_by = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  });

  const baseUrl = makeBaseUrl(server);
  const headers = authHeaders({ userId: adminUser.id, username: adminUser.username });

  const createDenied = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      slug: `guard-create-${slugSuffix}`,
      title: "创建拦截",
      subtitle: "",
      contactType: "landing_qr",
      targetUrl: "",
      wechatId: "guard-create",
      qrImageDataUrl: "data:image/png;base64,QUJDREVGRw==",
      showInPricing: true,
      isActive: true,
      sortOrder: 10,
    }),
  });
  assert.equal(createDenied.status, 403);
  assert.equal((await createDenied.json())?.error?.code, "ADMIN_CONFIRM_REQUIRED");

  const updateDenied = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts/${existingContactId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      title: "更新拦截",
    }),
  });
  assert.equal(updateDenied.status, 403);
  assert.equal((await updateDenied.json())?.error?.code, "ADMIN_CONFIRM_REQUIRED");

  const deleteDenied = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts/${existingContactId}`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleteDenied.status, 403);
  assert.equal((await deleteDenied.json())?.error?.code, "ADMIN_CONFIRM_REQUIRED");
});

test("external_url writes require configured allowlist and allowed hostname", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const slugSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminUser = {
    id: `wechat_admin_allow_${suffix}`,
    username: `wechat_admin_allow_${suffix}`,
    password: "Admin1234!Aa",
  };

  run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  const mfaSetup = insertAdminUser(adminUser);
  clearAdminWechatContactsWriteRateLimit();
  const previousAllowlist = [...(env.wechatContactExternalUrlAllowlist || [])];
  t.after(() => {
    env.wechatContactExternalUrlAllowlist = previousAllowlist;
  });

  const server = await createAdminServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearAdminWechatContactsWriteRateLimit();
    run(`DELETE FROM wechat_contacts WHERE created_by = $adminId OR updated_by = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  });

  const baseUrl = makeBaseUrl(server);
  const confirmToken = await fetchAdminConfirmToken({
    baseUrl,
    adminUser,
    secret: mfaSetup.secret,
  });
  const headers = {
    ...authHeaders({ userId: adminUser.id, username: adminUser.username }),
    "x-admin-confirm-token": confirmToken,
  };

  env.wechatContactExternalUrlAllowlist = [];
  const unconfigured = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      slug: `allow-empty-${slugSuffix}`,
      title: "未配置白名单",
      subtitle: "",
      contactType: "external_url",
      targetUrl: "https://promo.example.com/a",
      wechatId: "",
      qrImageDataUrl: "",
      showInPricing: true,
      isActive: true,
      sortOrder: 10,
    }),
  });
  assert.equal(unconfigured.status, 400);
  assert.match(String((await unconfigured.json())?.message || ""), /未配置 external_url 白名单/);

  env.wechatContactExternalUrlAllowlist = ["promo.example.com"];
  const createAllowed = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      slug: `allow-ok-${slugSuffix}`,
      title: "允许域名",
      subtitle: "",
      contactType: "external_url",
      targetUrl: "https://promo.example.com/path",
      wechatId: "",
      qrImageDataUrl: "",
      showInPricing: true,
      isActive: true,
      sortOrder: 11,
    }),
  });
  assert.equal(createAllowed.status, 200);
  const createdPayload = await createAllowed.json();
  const createdId = String(createdPayload?.data?.id || "");
  assert.ok(createdId);

  const updateDenied = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts/${createdId}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      targetUrl: "https://evil.example.com/path",
    }),
  });
  assert.equal(updateDenied.status, 400);
  assert.match(String((await updateDenied.json())?.message || ""), /白名单/);
});

test("wechat contact writes are rate limited", async (t) => {
  await initDatabase();

  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const adminUser = {
    id: `wechat_admin_rate_${suffix}`,
    username: `wechat_admin_rate_${suffix}`,
    password: "Admin1234!Aa",
  };

  run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
  run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  insertAdminUser(adminUser);
  clearAdminWechatContactsWriteRateLimit();

  const server = await createAdminServer();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    clearAdminWechatContactsWriteRateLimit();
    run(`DELETE FROM wechat_contacts WHERE created_by = $adminId OR updated_by = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM admin_audit_logs WHERE admin_user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM user_notifications WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM security_event_logs WHERE user_id = $adminId`, { $adminId: adminUser.id });
    run(`DELETE FROM users WHERE id = $adminId`, { $adminId: adminUser.id });
  });

  const baseUrl = makeBaseUrl(server);
  const headers = authHeaders({ userId: adminUser.id, username: adminUser.username });
  let lastStatus = 0;
  for (let index = 0; index < 41; index += 1) {
    const response = await fetch(`${baseUrl}/api/v1/admin/wechat-contacts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        slug: `rate-${suffix}-${index}`,
        title: "限流测试",
        subtitle: "",
        contactType: "landing_qr",
        targetUrl: "",
        wechatId: "wx-rate",
        qrImageDataUrl: "data:image/png;base64,QUJDREVGRw==",
        showInPricing: true,
        isActive: true,
        sortOrder: 20,
      }),
    });
    lastStatus = response.status;
  }

  assert.equal(lastStatus, 429);
});
