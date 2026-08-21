import { Router } from 'express';
import {
  loginUser,
  getMe,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser
} from '../controllers/authController.js';
import { protectRetailSathi, requireAdmin } from '../middleware/retailsathiAuth.js';

const authRouter = Router();

// Public auth route
authRouter.post('/login', loginUser);

// Protected routes
authRouter.get('/me', protectRetailSathi, getMe);

// Admin-only staff/cashier management routes
authRouter.get('/users', protectRetailSathi, requireAdmin, getAllUsers);
authRouter.post('/users', protectRetailSathi, requireAdmin, createUser);
authRouter.put('/users/:id', protectRetailSathi, requireAdmin, updateUser);
authRouter.delete('/users/:id', protectRetailSathi, requireAdmin, deleteUser);

export default authRouter;
