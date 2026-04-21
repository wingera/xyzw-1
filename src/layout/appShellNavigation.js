import {
  LogoAndroid,
  Megaphone,
  Settings,
} from "@vicons/ionicons5";

export const ANDROID_APP_MENU_ROUTE = "/android-app";
export const ANDROID_APP_USER_ACTION = "android-app-download";

export const createSupportMenuOptions = (renderIcon) => [
  { label: "Android App 下载", key: ANDROID_APP_MENU_ROUTE, icon: renderIcon(LogoAndroid) },
  { label: "个人设置", key: "/admin/profile", icon: renderIcon(Settings) },
  { label: "功能反馈", key: "/admin/feedback", icon: renderIcon(Megaphone) },
];

export const createUserMenuOptions = () => [
  {
    label: "个人设置",
    key: "profile",
  },
  {
    label: "Android App 下载",
    key: ANDROID_APP_USER_ACTION,
  },
  {
    label: "退出账号",
    key: "logout-account",
  },
  {
    label: "仅清除当前账号Token",
    key: "clear-tokens",
  },
];
