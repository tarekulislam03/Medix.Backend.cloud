import jwt from "jsonwebtoken";
import Store from "../../features/store/models/storeModel.js";

export const protect = async (req, res, next) => {
    try {
        let token;

        if (
            req.headers.authorization &&
            req.headers.authorization.startsWith("Bearer")
        ) {
            token = req.headers.authorization.split(" ")[1];
        } else if (req.cookies?.token) {
            token = req.cookies.token;
        }

        if (!token) {
            let defaultStore = await Store.findOne();
            if (!defaultStore) {
                defaultStore = await Store.create({
                    storeName: "RetailSathi Main Store",
                    email: "store@retailsathi.local"
                });
            }
            req.storeId = defaultStore._id;
            return next();
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = decoded.userId;
        req.storeId = decoded.storeId;

        next();

    } catch (error) {
        console.error("Auth Middleware Error:", error);
        res.status(401).json({ message: "Not authorized, token failed" });
    }
};