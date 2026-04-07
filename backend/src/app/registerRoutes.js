import authRoutes from "../routes/auth.js";
import roleRoutes from "../routes/roles.js";
import taskRoutes from "../routes/tasks.js";
import adminRoutes from "../routes/admin.js";
import binFileRoutes from "../routes/binFiles.js";
import userPreferencesRoutes from "../routes/userPreferences.js";
import resourceChangeLogsRoutes from "../routes/resourceChangeLogs.js";
import taskControlRoutes from "../routes/taskControl.js";
import feedbackRoutes from "../routes/feedbacks.js";
import notificationRoutes from "../routes/notifications.js";
import wechatProxyRoutes from "../routes/wechatProxy.js";
import tokenImportProxyRoutes from "../routes/tokenImportProxy.js";
import tokenActivationRoutes from "../routes/tokenActivations.js";
import publicWechatContactsRoutes from "../routes/publicWechatContacts.js";
import adminWechatContactsRoutes from "../routes/adminWechatContacts.js";
import publicReferralsRoutes from "../routes/publicReferrals.js";
import adminReferralsRoutes from "../routes/adminReferrals.js";
import { publicBuildInfo } from "../lib/buildInfo.js";
import { createUserRoutes } from "./userRoutes.js";

export function registerRoutes(app) {
  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      message: "ok",
      time: new Date().toISOString(),
      build: publicBuildInfo,
    });
  });

  app.get("/api/v1/health", (_req, res) => {
    res.json({
      success: true,
      message: "ok",
      time: new Date().toISOString(),
      build: publicBuildInfo,
    });
  });

  app.get("/api/v1/version", (_req, res) => {
    res.json({
      success: true,
      data: publicBuildInfo,
    });
  });

  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/admin", adminRoutes);
  app.use("/api/v1/admin", adminWechatContactsRoutes);
  app.use("/api/v1/admin", adminReferralsRoutes);
  app.use("/api/v1", publicWechatContactsRoutes);
  app.use("/api/v1", publicReferralsRoutes);
  app.use("/api/v1", wechatProxyRoutes);
  app.use("/api/v1", tokenImportProxyRoutes);
  app.use("/api/v1", roleRoutes);
  app.use("/api/v1", taskRoutes);
  app.use("/api/v1", binFileRoutes);
  app.use("/api/v1", userPreferencesRoutes);
  app.use("/api/v1", resourceChangeLogsRoutes);
  app.use("/api/v1", taskControlRoutes);
  app.use("/api/v1", feedbackRoutes);
  app.use("/api/v1", notificationRoutes);
  app.use("/api/v1", tokenActivationRoutes);
  app.use("/api/v1/user", createUserRoutes());
}
