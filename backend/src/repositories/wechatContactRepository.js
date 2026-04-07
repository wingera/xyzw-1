import { query, run } from "../db/client.js";

const toBoolean = (value) => Number(value) === 1;
const toNullableString = (value) => {
  const text = String(value || "").trim();
  return text || null;
};

const mapAdminRow = (row = {}) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  subtitle: toNullableString(row.subtitle),
  contactType: row.contactType,
  targetUrl: toNullableString(row.targetUrl),
  wechatId: toNullableString(row.wechatId),
  qrImageDataUrl: toNullableString(row.qrImageDataUrl),
  showInPricing: toBoolean(row.showInPricing),
  isActive: toBoolean(row.isActive),
  sortOrder: Number(row.sortOrder) || 100,
  createdBy: toNullableString(row.createdBy),
  updatedBy: toNullableString(row.updatedBy),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const mapPublicListRow = (row = {}) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  subtitle: toNullableString(row.subtitle),
  contactType: row.contactType,
  sortOrder: Number(row.sortOrder) || 100,
});

const mapPublicDetailRow = (row = {}) => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  subtitle: toNullableString(row.subtitle),
  contactType: row.contactType,
  targetUrl: toNullableString(row.targetUrl),
  wechatId: toNullableString(row.wechatId),
  qrImageDataUrl: toNullableString(row.qrImageDataUrl),
});

export const wechatContactRepository = {
  listForAdmin() {
    return query(
      `SELECT
        id,
        slug,
        title,
        subtitle,
        contact_type as contactType,
        target_url as targetUrl,
        wechat_id as wechatId,
        qr_image_data_url as qrImageDataUrl,
        show_in_pricing as showInPricing,
        is_active as isActive,
        sort_order as sortOrder,
        created_by as createdBy,
        updated_by as updatedBy,
        created_at as createdAt,
        updated_at as updatedAt
      FROM wechat_contacts
      ORDER BY sort_order ASC, created_at ASC, id ASC`,
    ).map(mapAdminRow);
  },

  listPublicPricing() {
    return query(
      `SELECT
        id,
        slug,
        title,
        subtitle,
        contact_type as contactType,
        sort_order as sortOrder
      FROM wechat_contacts
      WHERE is_active = 1
        AND show_in_pricing = 1
      ORDER BY sort_order ASC, created_at ASC, id ASC`,
    ).map(mapPublicListRow);
  },

  findPublicBySlug(slug) {
    const rows = query(
      `SELECT
        id,
        slug,
        title,
        subtitle,
        contact_type as contactType,
        target_url as targetUrl,
        wechat_id as wechatId,
        qr_image_data_url as qrImageDataUrl
      FROM wechat_contacts
      WHERE slug = $slug
        AND is_active = 1
        AND show_in_pricing = 1
      LIMIT 1`,
      {
        $slug: String(slug || "").trim(),
      },
    );
    return rows[0] ? mapPublicDetailRow(rows[0]) : null;
  },

  create({
    id,
    slug,
    title,
    subtitle,
    contactType,
    targetUrl,
    wechatId,
    qrImageDataUrl,
    showInPricing,
    isActive,
    sortOrder,
    createdBy,
    updatedBy,
    createdAt,
    updatedAt,
  }) {
    run(
      `INSERT INTO wechat_contacts (
        id,
        slug,
        title,
        subtitle,
        contact_type,
        target_url,
        wechat_id,
        qr_image_data_url,
        show_in_pricing,
        is_active,
        sort_order,
        created_by,
        updated_by,
        created_at,
        updated_at
      ) VALUES (
        $id,
        $slug,
        $title,
        $subtitle,
        $contactType,
        $targetUrl,
        $wechatId,
        $qrImageDataUrl,
        $showInPricing,
        $isActive,
        $sortOrder,
        $createdBy,
        $updatedBy,
        $createdAt,
        $updatedAt
      )`,
      {
        $id: id,
        $slug: slug,
        $title: title,
        $subtitle: subtitle || null,
        $contactType: contactType,
        $targetUrl: targetUrl || null,
        $wechatId: wechatId || null,
        $qrImageDataUrl: qrImageDataUrl || null,
        $showInPricing: showInPricing ? 1 : 0,
        $isActive: isActive ? 1 : 0,
        $sortOrder: Number(sortOrder) || 100,
        $createdBy: createdBy || null,
        $updatedBy: updatedBy || null,
        $createdAt: createdAt,
        $updatedAt: updatedAt,
      },
    );
  },

  update({
    id,
    slug,
    title,
    subtitle,
    contactType,
    targetUrl,
    wechatId,
    qrImageDataUrl,
    showInPricing,
    isActive,
    sortOrder,
    updatedBy,
    updatedAt,
  }) {
    const result = run(
      `UPDATE wechat_contacts
       SET slug = $slug,
           title = $title,
           subtitle = $subtitle,
           contact_type = $contactType,
           target_url = $targetUrl,
           wechat_id = $wechatId,
           qr_image_data_url = $qrImageDataUrl,
           show_in_pricing = $showInPricing,
           is_active = $isActive,
           sort_order = $sortOrder,
           updated_by = $updatedBy,
           updated_at = $updatedAt
       WHERE id = $id`,
      {
        $id: id,
        $slug: slug,
        $title: title,
        $subtitle: subtitle || null,
        $contactType: contactType,
        $targetUrl: targetUrl || null,
        $wechatId: wechatId || null,
        $qrImageDataUrl: qrImageDataUrl || null,
        $showInPricing: showInPricing ? 1 : 0,
        $isActive: isActive ? 1 : 0,
        $sortOrder: Number(sortOrder) || 100,
        $updatedBy: updatedBy || null,
        $updatedAt: updatedAt,
      },
    );
    return Number(result?.changes || 0);
  },

  remove(id) {
    const result = run(
      `DELETE FROM wechat_contacts
       WHERE id = $id`,
      {
        $id: String(id || "").trim(),
      },
    );
    return Number(result?.changes || 0);
  },
};
