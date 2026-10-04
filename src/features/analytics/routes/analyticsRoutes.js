import express from "express";
import { protect } from "../../../core/middleware/authMiddleware.js";
import {
    getOverview,
    getApiUsage,
    getUserActivity,
    getOcrAiAnalytics,
    getErrors,
    getLiveRequests,
    getBackendHealth
} from "../controllers/analyticsController.js";

import { getBillingRecommendations } from "../controllers/recommendationController.js";
import { generateReportForStore } from "../controllers/whatsappReportController.js";

const analyticsRouter = express.Router();

analyticsRouter.get("/overview", getOverview);
analyticsRouter.get("/api-usage", getApiUsage);
analyticsRouter.get("/user-activity", getUserActivity);
analyticsRouter.get("/ocr-ai", getOcrAiAnalytics);
analyticsRouter.get("/errors", getErrors);
analyticsRouter.get("/live-requests", getLiveRequests);
analyticsRouter.get("/health", getBackendHealth);
analyticsRouter.get("/recommendations", protect, getBillingRecommendations);

// Generate report text for WhatsApp
analyticsRouter.get("/whatsapp-report/:storeId", protect, generateReportForStore);

export default analyticsRouter;


