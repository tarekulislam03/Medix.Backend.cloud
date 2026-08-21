import { Router } from "express";
import {
    createCustomer,
    getAllCustomers,
    getCustomerById,
    updateCustomer,
    deleteCustomer,
    searchCustomer,
    getCustomerLastPurchase,
    getCustomerCredit,
    payCustomerDue,
} from "../controllers/customerController.js";


const customerRouter = Router();

customerRouter.get("/", getAllCustomers);
customerRouter.post("/", createCustomer);
customerRouter.get("/search", searchCustomer);
customerRouter.get("/get", getAllCustomers);
customerRouter.post("/create", createCustomer);
customerRouter.get("/get/:id", getCustomerById);
customerRouter.get("/:id", getCustomerById);
customerRouter.put("/update/:id", updateCustomer);
customerRouter.put("/:id", updateCustomer);
customerRouter.delete("/delete/:id", deleteCustomer);
customerRouter.delete("/:id", deleteCustomer);
customerRouter.get("/lastpurchase/:id", getCustomerLastPurchase);
customerRouter.get("/credit/:id", getCustomerCredit);
customerRouter.post("/pay-due/:id", payCustomerDue);

export default customerRouter;