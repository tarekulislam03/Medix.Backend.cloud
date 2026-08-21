import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import xssMiddleware from './core/middleware/xssMiddleware.js';
import { protect } from "./core/middleware/authMiddleware.js";
import apiLogger from "./core/middleware/apiLogger.js";
import analyticsRouter from "./features/analytics/routes/analyticsRoutes.js";

const app = express();

// 1. Logging middleware
app.use(apiLogger);

// 2. Security headers
app.use(helmet());

// 3. CORS Configuration
const allowedOrigins = [
  'https://app.usemedix.online',
  'https://usemedix.online',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
  'http://localhost:19006'
];

app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (like mobile apps, curl, or server-to-server)
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.usemedix.online')) {
      callback(null, true);
    } else {
      callback(null, true); // fallback to allow during production deployment
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'storeid', 'storeId']
}));

// 4. Parse body
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

// 5. Sanitize
app.use(xssMiddleware);

import userRouter from "./features/user/routes/userRoutes.js";
import productRouter from "./features/product/routes/productRoutes.js";
import billingRouter from "./features/billing/routes/billingRoutes.js";
import salesRouter from "./features/sales/routes/salesRoutes.js";
import customerRouter from "./features/customer/routes/customerRoutes.js";
import labelRouter from "./features/label/routes/labelRoutes.js";
import settingsRouter from "./features/settings/routes/settingsRoutes.js";
import purchaseRouter from "./features/purchase/routes/purchaseRoutes.js";
import aiImportRouter from "./features/purchase/routes/aiImportRoutes.js";
import gstRouter from "./features/gst/routes/gstRoutes.js";
import expenseRouter from "./features/expense/routes/expenseRoutes.js";
import masterMedicineRouter from "./features/masterMedicine/routes/masterMedicineRoutes.js";
import stockMovementRouter from "./features/stockMovement/routes/stockMovementRoutes.js";
import savingsRouter from "./features/savings/routes/savingsRoutes.js";
import adminBillingRouter from "./features/subscriptionAdmin/routes/adminBillingRoutes.js";
import storeBillingRouter from "./features/billing/routes/storeBillingRoutes.js";
import retailsathiRouter from "./features/retailsathi/routes/retailsathiRoutes.js";

// 6. Routes
app.use("/api/v1/analytics", analyticsRouter);
app.use("/api/v1/user", userRouter);
app.use("/api/v1/product", protect, productRouter);
app.use("/api/v1/billing", protect, billingRouter);
app.use("/api/v1/sales", protect, salesRouter);
app.use("/api/v1/customer", protect, customerRouter);
app.use('/api/v1/barcode', protect, labelRouter);
app.use('/api/v1/settings', protect, settingsRouter);
app.use('/api/v1/purchase', protect, purchaseRouter);
app.use('/api/v1/purchase', protect, aiImportRouter);
app.use('/api/v1/gst', protect, gstRouter);
app.use('/api/v1/expenses', protect, expenseRouter);
app.use("/api/v1/master-medicines", masterMedicineRouter);
app.use("/api/v1/stock-movement", protect, stockMovementRouter);
app.use("/api/v1/savings", protect, savingsRouter);
app.use("/api/v1/admin/billing", adminBillingRouter);
app.use("/api/v1/store/billing", storeBillingRouter);
app.use("/retailsathi/api/v1", retailsathiRouter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

export default app;