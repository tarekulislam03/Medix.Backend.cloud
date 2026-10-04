import express from "express";
import { setupSubscription, getPendingApprovals, approvePayment, getAllSubscriptions, getAllStores, markAllPaid, deleteSubscription, addCustomAlert, removeCustomAlert, toggleTrial, toggleBlock, getPlatformRevenue } from "../controllers/adminBillingController.js";
import { protect } from "../../../core/middleware/authMiddleware.js";

const router = express.Router();

router.get("/stores", getAllStores);
router.get("/revenue", getPlatformRevenue);
router.post("/setup", setupSubscription);
router.post("/custom-alert", addCustomAlert);
router.delete("/custom-alert/:storeId", removeCustomAlert);
router.get("/pending", getPendingApprovals);
router.put("/confirm", approvePayment);
router.get("/", getAllSubscriptions);
router.put("/mark-all-paid/:storeId", markAllPaid);
router.delete("/subscription/:storeId", deleteSubscription);
router.put("/trial/:storeId", toggleTrial);
router.put("/block/:storeId", toggleBlock);

export default router;
