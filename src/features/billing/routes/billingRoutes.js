import { Router } from "express";
import { checkout } from "../controllers/checkoutController.js";

const billingRouter = Router();

billingRouter.post("/", checkout);
billingRouter.post("/checkout", checkout);

export default billingRouter;