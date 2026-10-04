import { Router } from "express";
import multer from "multer";
import * as aiImportController from "../controllers/aiImportController.js";

const router = Router();

// Multer config — memory storage, up to 10 images, 10MB each
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB per file
        files: 10,                   // max 10 pages
    },
    fileFilter: (_req, file, cb) => {
        const allowed = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "image/heic",
            "image/heif",
        ];
        if (allowed.includes(file.mimetype.toLowerCase())) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}. Accepted: JPEG, PNG, WebP, HEIC, HEIF.`));
        }
    },
});

// ── AI Import Endpoints ──────────────────────────────────────────────────────
router.post("/ai-import", upload.array("images", 10), aiImportController.startImport);
router.get("/ai-import/jobs", aiImportController.getJobs);
router.post("/ai-import/confirm", aiImportController.confirmImport);
router.patch("/ai-import/:id/reject", aiImportController.rejectImport);

// ── External bill-to-json proxy (avoids browser CORS) ───────────────────────
router.post("/ai-import/parse-bill", upload.single("bill"), aiImportController.parseBillProxy);

export default router;

