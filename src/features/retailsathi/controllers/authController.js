import jwt from 'jsonwebtoken';
import RetailSathiUser from '../models/RetailSathiUser.js';

const JWT_SECRET = process.env.JWT_SECRET || 'retailsathi_jwt_secret_key_2026';

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
};

// Seed default Admin & Cashier accounts if DB is empty
export const seedDefaultUsers = async () => {
  try {
    const adminExists = await RetailSathiUser.findOne({ username: 'admin' });
    if (!adminExists) {
      console.log('Seeding default RetailSathi admin account...');
      await RetailSathiUser.create({
        username: 'admin',
        password: 'adminpassword',
        name: 'System Admin',
        role: 'admin',
        phone: '9999999999'
      });
    }

    const cashierExists = await RetailSathiUser.findOne({ username: 'cashier' });
    if (!cashierExists) {
      console.log('Seeding default RetailSathi cashier account...');
      await RetailSathiUser.create({
        username: 'cashier',
        password: 'cashierpassword',
        name: 'Primary Cashier',
        role: 'cashier',
        phone: '8888888888'
      });
    }
  } catch (err) {
    console.warn('RetailSathi user seeding warning:', err.message);
  }
};

// Login user
export const loginUser = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Please provide username and password' });
    }

    // Auto-seed default admin/cashier if missing
    await seedDefaultUsers();

    const user = await RetailSathiUser.findOne({ username: username.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        phone: user.phone
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Get current user info
export const getMe = async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
};

// Admin: Get all staff/users
export const getAllUsers = async (req, res) => {
  try {
    const users = await RetailSathiUser.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, count: users.length, users });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: Create new cashier or admin user
export const createUser = async (req, res) => {
  try {
    const { username, password, name, role, phone } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({ success: false, message: 'Username, password, and name are required' });
    }

    const existing = await RetailSathiUser.findOne({ username: username.toLowerCase().trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username is already taken' });
    }

    const newUser = await RetailSathiUser.create({
      username: username.toLowerCase().trim(),
      password,
      name: name.trim(),
      role: role === 'admin' ? 'admin' : 'cashier',
      phone: phone || ''
    });

    res.status(201).json({
      success: true,
      message: 'Staff user created successfully',
      user: {
        id: newUser._id,
        username: newUser.username,
        name: newUser.name,
        role: newUser.role,
        phone: newUser.phone,
        createdAt: newUser.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: Update cashier or user
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, role, password, isActive } = req.body;

    const user = await RetailSathiUser.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name.trim();
    if (phone !== undefined) user.phone = phone;
    if (role && (role === 'admin' || role === 'cashier')) user.role = role;
    if (isActive !== undefined) user.isActive = Boolean(isActive);
    if (password && password.trim().length > 0) user.password = password;

    await user.save();

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: user._id,
        username: user.username,
        name: user.name,
        role: user.role,
        phone: user.phone,
        isActive: user.isActive
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Admin: Delete cashier or user
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.user._id.toString() === id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own active admin account' });
    }

    const user = await RetailSathiUser.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
