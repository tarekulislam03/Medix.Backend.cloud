import { Router } from 'express';
import productRouter from '../../product/routes/productRoutes.js';
import customerRouter from '../../customer/routes/customerRoutes.js';
import billingRouter from '../../billing/routes/billingRoutes.js';
import stockMovementRouter from '../../stockMovement/routes/stockMovementRoutes.js';
import authRouter from './authRoutes.js';
import { seedDefaultUsers } from '../controllers/authController.js';

const retailsathiRouter = Router();

// Automatically seed default accounts on start
seedDefaultUsers();

retailsathiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'RetailSathi API',
    timestamp: new Date().toISOString()
  });
});

retailsathiRouter.use('/auth', authRouter);
retailsathiRouter.use('/product', productRouter);
retailsathiRouter.use('/customer', customerRouter);
retailsathiRouter.use('/billing', billingRouter);
retailsathiRouter.use('/stock-movement', stockMovementRouter);

export default retailsathiRouter;


