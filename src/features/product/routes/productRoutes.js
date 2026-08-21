import { Router } from "express";
import multer from "multer";
import { createProduct, deleteProduct, getProductById, getProducts, searchProduct, updateProduct, soonToExpiry, lowStock, autoImportProducts, autoImportConfirm, getLooseMedicinePrice, bulkAddFromMaster } from "../controllers/productController.js"
import { normalizeImage } from "../../../core/middleware/imageNormalizationMiddleware.js";

const productRouter = Router();

productRouter.get("/", getProducts);
productRouter.post("/", createProduct);
productRouter.get("/search", searchProduct);
productRouter.get("/lowstock", lowStock);
productRouter.get("/soontoexpiry", soonToExpiry);
productRouter.get("/get", getProducts);
productRouter.post("/create", createProduct);
productRouter.get("/get/:id", getProductById);
productRouter.get("/:id", getProductById);
productRouter.put("/update/:id", updateProduct);
productRouter.put("/:id", updateProduct);
productRouter.delete("/delete/:id", deleteProduct);
productRouter.delete("/:id", deleteProduct);
productRouter.get("/loose-price/:id", getLooseMedicinePrice);
productRouter.post("/bulk-from-master", bulkAddFromMaster);

// auto import route
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // Increased limit for HEIC files
});


productRouter.post(
  "/auto-import",
  upload.single("bill"),
  autoImportProducts
);



productRouter.post(
  "/auto-import/confirm",
  autoImportConfirm
);

export default productRouter;