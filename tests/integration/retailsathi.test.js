import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import app from '../../src/app.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  setTestEnv
} from '../setup/testHelpers.js';
import RetailSathiUser from '../../src/features/retailsathi/models/RetailSathiUser.js';
import Inventory from '../../src/features/product/models/productModel.js';
import Customer from '../../src/features/customer/models/customerModel.js';
import Store from '../../src/features/store/models/storeModel.js';
import User from '../../src/features/user/models/userModel.js';
import { IDS, seedDatabase, checkoutPayloads } from '../fixtures/seedData.js';

const models = { Store, User, Customer, Inventory };

describe('RetailSathi Backend API Integration Tests', () => {
  beforeAll(async () => {
    setTestEnv();
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await seedDatabase(models);
  });

  // ---------------------------------------------------------------------------
  // 1. Health Check Endpoint
  // ---------------------------------------------------------------------------
  describe('GET /retailsathi/api/v1/health', () => {
    it('should return 200 OK with app details and timestamp', async () => {
      const res = await request(app).get('/retailsathi/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.app).toBe('RetailSathi API');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Authentication API (Login)
  // ---------------------------------------------------------------------------
  describe('POST /retailsathi/api/v1/auth/login', () => {
    it('should auto-seed and login successfully as default admin', async () => {
      const res = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'admin', password: 'adminpassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('admin');
      expect(res.body.user.role).toBe('admin');
    });

    it('should auto-seed and login successfully as default cashier', async () => {
      const res = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'cashier', password: 'cashierpassword' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('cashier');
      expect(res.body.user.role).toBe('cashier');
    });

    it('should reject login if username or password is missing', async () => {
      const res = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'admin' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/provide username and password/i);
    });

    it('should reject login with wrong password', async () => {
      const res = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'admin', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid username or password/i);
    });

    it('should reject login with non-existent username', async () => {
      const res = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'unknown_user', password: 'password123' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid username or password/i);
    });

    it('should reject login for deactivated user account', async () => {
      // Create deactivated user
      await RetailSathiUser.create({
        username: 'inactive_staff',
        password: 'password123',
        name: 'Inactive Staff',
        role: 'cashier',
        isActive: false
      });

      const res = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'inactive_staff', password: 'password123' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/account is deactivated/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. User Profile Endpoint (GET /me)
  // ---------------------------------------------------------------------------
  describe('GET /retailsathi/api/v1/auth/me', () => {
    it('should return authenticated user details for valid token', async () => {
      const loginRes = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'admin', password: 'adminpassword' });

      const token = loginRes.body.token;

      const res = await request(app)
        .get('/retailsathi/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.username).toBe('admin');
      expect(res.body.user.role).toBe('admin');
    });

    it('should reject request when no authorization token is provided', async () => {
      const res = await request(app).get('/retailsathi/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/no token provided/i);
    });

    it('should reject request when token is invalid', async () => {
      const res = await request(app)
        .get('/retailsathi/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid_token_xyz');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/invalid or expired token/i);
    });

    it('should reject request if account was deactivated after token issuance', async () => {
      const user = await RetailSathiUser.create({
        username: 'staff_temp',
        password: 'password123',
        name: 'Temp Staff',
        role: 'cashier',
        isActive: true
      });

      const loginRes = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'staff_temp', password: 'password123' });

      const token = loginRes.body.token;

      // Deactivate user in DB
      user.isActive = false;
      await user.save();

      const res = await request(app)
        .get('/retailsathi/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/deactivated/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Staff Management API (Admin Only)
  // ---------------------------------------------------------------------------
  describe('Staff Management - Admin Only (/retailsathi/api/v1/auth/users)', () => {
    let adminToken;
    let cashierToken;
    let adminUserId;

    beforeEach(async () => {
      // Seed admin & cashier via login
      const adminLogin = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'admin', password: 'adminpassword' });
      adminToken = adminLogin.body.token;
      adminUserId = adminLogin.body.user.id;

      const cashierLogin = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'cashier', password: 'cashierpassword' });
      cashierToken = cashierLogin.body.token;
    });

    it('should allow admin to list all staff users', async () => {
      const res = await request(app)
        .get('/retailsathi/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.users).toBeInstanceOf(Array);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
      
      // Ensure password field is excluded
      expect(res.body.users[0].password).toBeUndefined();
    });

    it('should deny non-admin cashier from listing staff users', async () => {
      const res = await request(app)
        .get('/retailsathi/api/v1/auth/users')
        .set('Authorization', `Bearer ${cashierToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/admin role required/i);
    });

    it('should allow admin to create a new cashier staff user', async () => {
      const payload = {
        username: 'john_cashier',
        password: 'securepassword123',
        name: 'John Doe',
        role: 'cashier',
        phone: '9876543210'
      };

      const res = await request(app)
        .post('/retailsathi/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.user.username).toBe('john_cashier');
      expect(res.body.user.role).toBe('cashier');

      // Verify newly created staff can log in
      const loginRes = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'john_cashier', password: 'securepassword123' });

      expect(loginRes.status).toBe(200);
      expect(loginRes.body.success).toBe(true);
    });

    it('should reject creation of staff with existing username', async () => {
      const payload = {
        username: 'admin',
        password: 'password123',
        name: 'Duplicate Admin'
      };

      const res = await request(app)
        .post('/retailsathi/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/already taken/i);
    });

    it('should reject creation when required fields are missing', async () => {
      const payload = {
        username: 'incomplete_user'
      };

      const res = await request(app)
        .post('/retailsathi/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/required/i);
    });

    it('should allow admin to update an existing staff user details and password', async () => {
      const createRes = await request(app)
        .post('/retailsathi/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'sam_staff', password: 'oldpassword', name: 'Sam' });

      const staffId = createRes.body.user.id;

      const updateRes = await request(app)
        .put(`/retailsathi/api/v1/auth/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Sam Updated',
          phone: '9123456789',
          password: 'newpassword123'
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.user.name).toBe('Sam Updated');
      expect(updateRes.body.user.phone).toBe('9123456789');

      // Verify login with updated password
      const newLoginRes = await request(app)
        .post('/retailsathi/api/v1/auth/login')
        .send({ username: 'sam_staff', password: 'newpassword123' });

      expect(newLoginRes.status).toBe(200);
      expect(newLoginRes.body.success).toBe(true);
    });

    it('should return 404 when updating non-existent staff ID', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .put(`/retailsathi/api/v1/auth/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Non Existent' });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/user not found/i);
    });

    it('should prevent admin from deleting their own active account', async () => {
      const res = await request(app)
        .delete(`/retailsathi/api/v1/auth/users/${adminUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/cannot delete your own/i);
    });

    it('should allow admin to delete another staff user', async () => {
      const createRes = await request(app)
        .post('/retailsathi/api/v1/auth/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'user_to_delete', password: 'pass123', name: 'Delete Me' });

      const staffId = createRes.body.user.id;

      const deleteRes = await request(app)
        .delete(`/retailsathi/api/v1/auth/users/${staffId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);
      expect(deleteRes.body.message).toMatch(/deleted successfully/i);

      // Verify user is gone from DB
      const deletedUser = await RetailSathiUser.findById(staffId);
      expect(deletedUser).toBeNull();
    });

    it('should return 404 when deleting a non-existent staff ID', async () => {
      const fakeId = '507f1f77bcf86cd799439011';
      const res = await request(app)
        .delete(`/retailsathi/api/v1/auth/users/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/user not found/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. RetailSathi Sub-router Integration (/retailsathi/api/v1/*)
  // ---------------------------------------------------------------------------
  describe('RetailSathi Mounted Sub-routes', () => {
    it('should access /retailsathi/api/v1/product and fetch product list', async () => {
      const res = await request(app).get('/retailsathi/api/v1/product');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should access /retailsathi/api/v1/customer/get and fetch customer list', async () => {
      const res = await request(app).get('/retailsathi/api/v1/customer/get');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should process billing checkout via /retailsathi/api/v1/billing/checkout', async () => {
      const payload = checkoutPayloads.singleItemCash;

      const res = await request(app)
        .post('/retailsathi/api/v1/billing/checkout')
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Billing successful');
      expect(res.body.invoice).toBeDefined();
    });

    it('should access /retailsathi/api/v1/stock-movement and fetch stock logs', async () => {
      const res = await request(app).get('/retailsathi/api/v1/stock-movement');

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });
  });
});
