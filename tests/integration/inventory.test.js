import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import app from '../../src/app.js';
import {
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  generateTestToken,
  setTestEnv
} from '../setup/testHelpers.js';
import { IDS, seedDatabase, checkoutPayloads } from '../fixtures/seedData.js';
import Inventory from '../../src/features/product/models/productModel.js';
import Customer from '../../src/features/customer/models/customerModel.js';
import Store from '../../src/features/store/models/storeModel.js';
import User from '../../src/features/user/models/userModel.js';

const models = { Store, User, Customer, Inventory };

describe('Inventory / Product API Integration', () => {
  let token;

  beforeAll(async () => {
    setTestEnv();
    await connectTestDB();
    token = generateTestToken(IDS.user, IDS.store);
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    await seedDatabase(models);
  });

  describe('CRUD for products under /api/v1/product', () => {
    it('should create a new product', async () => {
      const payload = {
        medicine_name: 'NEW MED',
        mrp: 50,
        quantity: 100,
        supplier_name: 'Test Supplier',
        expiry_date: '2025-12-31',
        alert_threshold: 10,
        tablets_per_strip: 10,
        cost_price: 30,
        batch_number: 'B-NEW',
        hsn_code: '1234',
        gst: 12
      };

      const res = await request(app)
        .post('/api/v1/product/create')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.medicine_name).toBe('NEW MED');
      expect(res.body.data.quantity).toBe(100);
      
      const dbProduct = await Inventory.findById(res.body.data._id);
      expect(dbProduct).toBeTruthy();
      expect(dbProduct.medicine_name).toBe('NEW MED');
    });

    it('should list all products', async () => {
      const res = await request(app)
        .get('/api/v1/product/get')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(5); // Seed data has 5 products
    });

    it('should get a product by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/product/get/${IDS.product1}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.medicine_name).toBe('DOLO 650');
    });

    it('should update a product', async () => {
      const res = await request(app)
        .put(`/api/v1/product/update/${IDS.product1}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ mrp: 40, quantity: 150 });

      expect(res.status).toBe(200);
      expect(res.body.data.mrp).toBe(40);
      expect(res.body.data.quantity).toBe(150);

      const dbProduct = await Inventory.findById(IDS.product1);
      expect(dbProduct.mrp).toBe(40);
      expect(dbProduct.quantity).toBe(150);
    });

    it('should delete a product', async () => {
      const res = await request(app)
        .delete(`/api/v1/product/delete/${IDS.product1}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);

      const dbProduct = await Inventory.findById(IDS.product1);
      expect(dbProduct).toBeNull();
    });
  });

  describe('Inventory Edge Cases (Checkout integration)', () => {
    it('should prevent negative stock (insufficient stock check)', async () => {
      const payload = checkoutPayloads.insufficientStock; // Trying to buy 999
      
      const res = await request(app)
        .post('/api/v1/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/Insufficient stock/);

      const dbProduct = await Inventory.findById(IDS.product5);
      expect(dbProduct.quantity).toBe(5); // Should remain unchanged
    });

    it('should retain batch-specific products with quantity 0 when stock reaches zero', async () => {
      // product3 has batch_number: 'AZ-B1' and quantity: 30
      const payload = {
        items: [
          { product_id: IDS.product3.toString(), quantity: 30, discount_percent: 0 },
        ],
        payment_method: 'cash',
        amount_paid: 3600, // 30 * 120
      };

      const res = await request(app)
        .post('/api/v1/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(200);

      const dbProduct = await Inventory.findById(IDS.product3);
      expect(dbProduct).toBeTruthy(); // Batch record is retained
      expect(dbProduct.quantity).toBe(0); // Quantity reaches 0
    });

    it('should retain non-batch products even when stock reaches zero', async () => {
      // product4 has batch_number: '' and quantity: 200
      const payload = {
        items: [
          { product_id: IDS.product4.toString(), quantity: 200, discount_percent: 0 },
        ],
        payment_method: 'cash',
        amount_paid: 5000, // 200 * 25
      };

      const res = await request(app)
        .post('/api/v1/billing/checkout')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(200);

      const dbProduct = await Inventory.findById(IDS.product4);
      expect(dbProduct).toBeTruthy(); // Should not be deleted
      expect(dbProduct.quantity).toBe(0); // Quantity should be 0
    });
  });
});
