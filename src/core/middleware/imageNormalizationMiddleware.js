import path from "path";
import sharp from "sharp";
import heicConvert from "heic-convert";

const MAX_SIZE = 950 * 1024; // 950KB safety margin

const normalizeImage = async (req, res, next) => {
    if (!req.file?.buffer) {
        return next();
    }

    try {
        const { mimetype, originalname } = req.file;

        let buffer = req.file.buffer;

        const ext = path.extname(originalname).toLowerCase();
        const isHeic =
            ["image/heic", "image/heif"].includes(mimetype) ||
            [".heic", ".heif"].includes(ext);

        // convert heic to jpeg
        if (isHeic) {
            buffer = await heicConvert({
                buffer,
                format: "JPEG",
                quality: 0.9,
            });
        }

        // First pass: Optimize contrast and sharpen resolution for small OCR text
        buffer = await sharp(buffer)
            .rotate()
            .grayscale()
            .normalize()
            .sharpen({ sigma: 1.2 })
            .resize({
                width: 3000,
                withoutEnlargement: true,
            })
            .jpeg({
                quality: 85,
                mozjpeg: true,
            })
            .toBuffer();

        // Keep reducing quality until under OCR.Space limit
        let quality = 75;

        while (buffer.length > MAX_SIZE && quality >= 40) {
            buffer = await sharp(buffer)
                .jpeg({
                    quality,
                    mozjpeg: true,
                })
                .toBuffer();

            quality -= 5;
        }

        req.file.buffer = buffer;
        req.file.mimetype = "image/jpeg";
        req.file.size = buffer.length;

        const baseName = path.parse(originalname).name;
        req.file.originalname = `${baseName}.jpg`;

        console.log(
            `Image normalized: ${req.file.originalname} | ${(buffer.length / 1024).toFixed(2)} KB`
        );

        next();

    } catch (error) {
        console.error("Image normalization failed:", error);

        return res.status(400).json({
            success: false,
            message: `Image normalization failed: ${error.message}`,
        });

    }
};

export { normalizeImage };