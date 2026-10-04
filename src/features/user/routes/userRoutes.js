import { Router } from "express";

import { loginUser, logoutUser, registerUser, getStores, getTotalUsers } from "../controllers/userController.js";
import { protect } from "../../../core/middleware/authMiddleware.js";
import { loginLimiter } from "../../../core/services/rateLimiter.js";

const userRouter = Router();

userRouter.post("/register", registerUser);
userRouter.post("/login", loginLimiter, loginUser);
userRouter.post("/logout", protect, logoutUser);
userRouter.get("/stores", getStores);
userRouter.get("/total-users", getTotalUsers);
userRouter.get("/count", getTotalUsers);

export default userRouter;