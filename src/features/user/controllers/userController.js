import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Store from "../../store/models/storeModel.js";
import User from "../models/userModel.js";
import { getSupabaseClients } from "../../../config/supabase.js";

// register user
const registerUser = async (req, res) => {
  try {
    const { storeName, phone, password } = req.body;

    const existingUser = await User.findOne({ phone });

    if (existingUser) {
      return res.status(400).json({ message: "Phone already registered" });
    }

    const store = await Store.create({
      storeName,
      contactNumber: phone
    });

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      phone,
      password: hashedPassword,
      storeId: store._id
    });

    const token = jwt.sign(
      {
        userId: user._id,
        storeId: store._id
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: true
    });

    res.status(201).json({
      message: "Store registered",
      user,
      token
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

//login user
const loginUser = async (req, res) => {
  try {
    const { phone, password } = req.body;


    // Security layers
    if (typeof phone !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid input' });
    };

    if (!/^\d{10}$/.test(phone)) {
      return res.status(400).json({ error: 'Invalid phone number' });
    };


    const user = await User.findOne({ phone }).populate("storeId");


    if (!user) {
      return res.status(401).json({ message: "Invalid Credentials!" });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ message: "Invalid Credentials!" });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        storeId: user.storeId._id
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: true
    });

    res.json({
      message: "Login successful",
      user,
      token
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// logout 
const logoutUser = async (req, res) => {
  try {
    res.cookie("token", "", {
      httpOnly: true,
      expires: new Date(0)
    });

    res.status(200).json({
      message: "Logged out successfully"
    });

  } catch (error) {
    res.status(500).json({
      message: "Logout failed"
    });
  }
};

// get all stores for admin operations
const getStores = async (req, res) => {
  try {
    const stores = await Store.find({}, "storeName _id contactNumber setupCost amc isTrial isBlocked");
    res.json({ success: true, data: stores });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// get total users number and calculate revenue/AMC from connected stores
const getTotalUsers = async (req, res) => {
  try {
    // 1. Get all users with their connected stores populated
    const users = await User.find({}).populate("storeId");
    const mongoUsersCount = users.length;

    let totalSetupCost = 0; // One Time Revenue
    let totalAmc = 0; // Annual Maintenance Contract
    const connectedStores = [];

    for (const user of users) {
      if (user.storeId) {
        const store = user.storeId;
        const setupCost = Number(store.setupCost) || 0;
        const amc = Number(store.amc) || 0;

        totalSetupCost += setupCost;
        totalAmc += amc;

        connectedStores.push({
          userId: user._id,
          phone: user.phone,
          storeId: store._id,
          storeName: store.storeName,
          setupCost,
          amc
        });
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        totalUsers: mongoUsersCount,
        totalRevenue: totalSetupCost,
        oneTimeRevenue: totalSetupCost,
        setupCost: totalSetupCost,
        totalAmc,
        amc: totalAmc,
        connectedStores,
        mongodb: {
          count: mongoUsersCount
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch metrics and users",
      error: error.message
    });
  }
};

export { registerUser, loginUser, logoutUser, getStores, getTotalUsers };