import { withRouteMeta } from "../meta";

export const publicRoutes = [
  {
    path: "/",
    name: "Home",
    component: () => import("@/views/Home.vue"),
    meta: withRouteMeta({
      title: "首页",
      layout: "public",
    }),
  },
  {
    path: "/login",
    name: "Login",
    component: () => import("@/views/Login.vue"),
    meta: withRouteMeta({
      title: "登录",
      layout: "auth",
    }),
  },
  {
    path: "/register",
    name: "Register",
    component: () => import("@/views/Register.vue"),
    meta: withRouteMeta({
      title: "注册",
      layout: "auth",
    }),
  },
  {
    path: "/forgot-password",
    name: "ForgotPassword",
    component: () => import("@/views/ForgotPassword.vue"),
    meta: withRouteMeta({
      title: "忘记密码",
      layout: "auth",
    }),
  },
  {
    path: "/mfa-qr-approve",
    name: "MfaQrApprove",
    component: () => import("@/views/MfaQrApprove.vue"),
    meta: withRouteMeta({
      title: "扫码二次验证",
      layout: "auth",
    }),
  },
  {
    path: "/mfa-reset",
    name: "MfaReset",
    component: () => import("@/views/MfaReset.vue"),
    meta: withRouteMeta({
      title: "重置二次验证",
      layout: "auth",
    }),
  },
  {
    path: "/game-roles",
    redirect: "/admin/dashboard",
    meta: withRouteMeta({
      hidden: true,
    }),
  },
  {
    path: "/changelog",
    name: "Changelog",
    component: () => import("@/views/Changelog.vue"),
    meta: withRouteMeta({
      title: "更新日志",
      layout: "public",
    }),
  },
  {
    path: "/pricing",
    name: "PricingMenu",
    component: () => import("@/views/PricingMenu.vue"),
    meta: withRouteMeta({
      title: "价格菜单",
      layout: "public",
    }),
  },
  {
    path: "/r/:code",
    name: "ReferralLanding",
    component: () => import("@/views/ReferralLanding.vue"),
    meta: withRouteMeta({
      title: "推广邀请",
      layout: "public",
      hidden: true,
    }),
  },
  {
    path: "/wx/:slug",
    name: "PublicWechatContact",
    component: () => import("@/views/PublicWechatContact.vue"),
    meta: withRouteMeta({
      title: "微信联系",
      layout: "public",
    }),
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: () => import("@/views/NotFound.vue"),
    meta: withRouteMeta({
      title: "页面不存在",
      layout: "public",
      hidden: true,
    }),
  },
];
