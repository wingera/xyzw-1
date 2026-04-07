import { withRouteMeta } from "../meta";

const adminChildren = [
  {
    path: "/tokens",
    name: "TokenImport",
    component: () => import("@/views/TokenImport/index.vue"),
    props: (route) => ({
      name: route.query.name,
      server: route.query.server,
      auto: route.query.auto === "true",
    }),
    meta: withRouteMeta({
      title: "Token管理",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "dashboard",
    name: "Dashboard",
    component: () => import("@/views/Dashboard.vue"),
    meta: withRouteMeta({
      title: "控制台",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "game-features",
    name: "GameFeatures",
    component: () => import("@/views/GameFeatures.vue"),
    meta: withRouteMeta({
      title: "游戏功能",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "lineup-assistant",
    name: "LineupAssistant",
    component: () => import("@/views/LineupAssistant.vue"),
    meta: withRouteMeta({
      title: "阵容助手",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "legion-war",
    name: "LegionWar",
    component: () => import("@/views/LegionWar.vue"),
    meta: withRouteMeta({
      title: "实时盐场",
      requiresAuth: true,
      requiresGameAccess: true,
      layout: "default",
    }),
  },
  {
    path: "profile",
    name: "Profile",
    component: () => import("@/views/Profile.vue"),
    meta: withRouteMeta({
      title: "个人设置",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "referral-center",
    name: "ReferralCenter",
    component: () => import("@/views/ReferralCenter.vue"),
    meta: withRouteMeta({
      title: "推广中心",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "feedback",
    name: "FeedbackCenter",
    component: () => import("@/views/FeedbackCenter.vue"),
    meta: withRouteMeta({
      title: "功能反馈",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "task-control",
    name: "TaskControl",
    component: () => import("@/views/TaskControl.vue"),
    meta: withRouteMeta({
      title: "任务控制",
      requiresAuth: true,
      layout: "default",
    }),
  },
  {
    path: "daily-tasks",
    name: "DailyTasks",
    component: () => import("@/views/DailyTasks.vue"),
    meta: withRouteMeta({
      title: "日常任务",
      requiresAuth: true,
      requiresGameAccess: true,
      layout: "default",
    }),
  },
  {
    path: "batch-daily-tasks",
    redirect: "/admin/task-control",
    meta: withRouteMeta({
      requiresAuth: true,
      requiresGameAccess: true,
      layout: "default",
      hidden: true,
    }),
  },
  {
    path: "admin-users",
    name: "AdminUsers",
    component: () => import("@/views/AdminUsers.vue"),
    meta: withRouteMeta({
      title: "账号管理",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
  {
    path: "admin-invites",
    name: "AdminInvites",
    component: () => import("@/views/AdminInvites.vue"),
    meta: withRouteMeta({
      title: "邀请码管理",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
  {
    path: "activation-codes",
    name: "AdminActivationCodes",
    component: () => import("@/views/AdminActivationCodes.vue"),
    meta: withRouteMeta({
      title: "激活码管理",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
  {
    path: "feedback-tickets",
    name: "AdminFeedbackTickets",
    component: () => import("@/views/AdminFeedbackTickets.vue"),
    meta: withRouteMeta({
      title: "工单管理",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
  {
    path: "task-control-logs",
    name: "AdminTaskControlLogs",
    component: () => import("@/views/AdminTaskControlLogs.vue"),
    meta: withRouteMeta({
      title: "后端任务日志",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
  {
    path: "changelog-broadcast",
    name: "AdminChangelogBroadcast",
    component: () => import("@/views/AdminChangelogBroadcast.vue"),
    meta: withRouteMeta({
      title: "更新日志广播",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
  {
    path: "wechat-contacts",
    name: "AdminWechatContacts",
    component: () => import("@/views/AdminWechatContacts.vue"),
    meta: withRouteMeta({
      title: "微信联系配置",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
  {
    path: "referrals",
    name: "AdminReferrals",
    component: () => import("@/views/AdminReferrals.vue"),
    meta: withRouteMeta({
      title: "推广邀请管理",
      requiresAuth: true,
      requiresAdmin: true,
      layout: "default",
    }),
  },
];

export const adminRoutes = [
  {
    path: "/admin",
    name: "DefaultLayout",
    component: () => import("@/layout/DefaultLayout.vue"),
    redirect: "/admin/dashboard",
    meta: withRouteMeta({
      requiresAuth: true,
      layout: "default",
      hidden: true,
    }),
    children: adminChildren,
  },
];
