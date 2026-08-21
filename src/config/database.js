import mongoose from "mongoose";
import { seedDefaultUsers } from "../features/retailsathi/controllers/authController.js";

const connectDB = async () => {
    try {
        const uri = process.env.MONGO_DB_URI || process.env.MONGO_URI;
        await mongoose.connect(uri);
        console.log("MongoDB Connected Successfully!");
        await seedDefaultUsers();
    } catch (error) {
        console.log("MongoDB Not Connected!", error);
        process.exit(1);
    }
}

export default connectDB;