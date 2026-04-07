import { nowIso, randomId } from "../db/sql.js";
import { adminAuditRepository } from "../repositories/adminAuditRepository.js";
import { createUserNotification } from "./notificationService.js";
import { recordSecurityEvent } from "./securityEventService.js";

const asJson = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({ note: "unserializable detail" });
  }
};

const ADMIN_ACTION_LABELS = {
  grant_admin: "授予管理员权限",
  revoke_admin: "移除管理员权限",
  update_user_access_scope: "修改账号功能范围",
  update_user_token_bind_limit: "修改 Token 上限",
  update_user_token_refresh_second_verify: "修改刷新二次验证状态",
  reset_user_password: "重置账号密码",
  revoke_user_sessions: "注销全部会话",
  create_password_reset_code: "生成短时验证码",
  create_mfa_reset_link: "生成二次验证重置链接",
  delete_user: "删除账号",
  create_invite_codes: "生成邀请码",
  disable_invite_code: "禁用邀请码",
  unbind_activation_code: "解绑激活码",
  unbind_all_activation_codes: "清空全部激活绑定",
  create_activation_codes: "生成激活码",
  disable_activation_code: "禁用激活码",
  delete_activation_code: "删除激活码",
  mark_referral_conversion_paid: "标记推广返佣已结算",
  reject_referral_conversion: "拒绝推广返佣",
  create_wechat_contact: "创建微信联系人",
  update_wechat_contact: "更新微信联系人",
  delete_wechat_contact: "删除微信联系人",
  broadcast_changelog_notice: "发送更新日志通知",
  update_feedback_status: "更新反馈状态",
  confirm_sensitive_action: "通过管理员二次确认",
  confirm_sensitive_action_failed: "管理员二次确认失败",
};

const ADMIN_TARGET_TYPE_LABELS = {
  user: "账号",
  feedback: "反馈工单",
  user_notification: "站内通知",
  invite_code: "邀请码",
  activation_code: "激活码",
  referral_attribution: "推广归因",
  referral_conversion: "推广返佣台账",
  wechat_contact: "微信联系人",
};

const getAdminActionLabel = (action) =>
  ADMIN_ACTION_LABELS[String(action || "").trim()] || String(action || "未知操作").trim();

const getAdminTargetTypeLabel = (targetType) =>
  ADMIN_TARGET_TYPE_LABELS[String(targetType || "").trim()] || String(targetType || "未知对象").trim();

export const recordAdminAudit = ({
  adminUserId,
  action,
  targetType,
  targetId = null,
  detail = {},
  ip = null,
  userAgent = null,
}) => {
  if (!adminUserId || !action || !targetType) {
    return;
  }

  adminAuditRepository.create({
    id: randomId("audit"),
    adminUserId,
    action,
    targetType,
    targetId,
    detailJson: asJson(detail),
    ip,
    userAgent,
    createdAt: nowIso(),
  });
  createUserNotification({
    userId: adminUserId,
    type: "security",
    title: "已执行管理员高敏操作",
    content: `操作：${getAdminActionLabel(action)}${targetType ? `，对象：${getAdminTargetTypeLabel(targetType)}` : ""}${targetId ? `（${targetId}）` : ""}`,
    payload: {
      action,
      targetType,
      targetId,
      detail,
    },
  });
  recordSecurityEvent({
    userId: adminUserId,
    eventType: "admin_sensitive_action",
    detail: {
      action,
      targetType,
      targetId,
      detail,
    },
    ip,
    userAgent,
  });
};
