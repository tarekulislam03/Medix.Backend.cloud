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
import { IDS, seedDatabase, autoImportConfirmPayload } from '../fixtures/seedData.js';
import Inventory from '../../src/features/product/models/productModel.js';
import Store from '../../src/features/store/models/storeModel.js';
import User from '../../src/features/user/models/userModel.js';
import Customer from '../../src/features/customer/models/customerModel.js';

const models = { Store, User, Customer, Inventory };

describe('Auto Import Confirm API Integration', () => {
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

  describe('POST /api/v1/product/auto-import/confirm', () => {
    it('should create new products and update existing ones', async () => {
      const payload = autoImportConfirmPayload;

      // Before request: DOLO 650 B001 has quantity 100
      const doloBefore = await Inventory.findOne({ 
        medicine_name: 'DOLO 650', 
        batch_number: 'B001' 
      });
      expect(doloBefore.quantity).toBe(100);

      const res = await request(app)
        .post('/api/v1/product/auto-import/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.new_products).toBe(1); // PANTOPRAZOLE 40
      expect(res.body.updated_products).toBe(1); // DOLO 650

      // Verify new product creation
      const panto = await Inventory.findOne({ medicine_name: 'PANTOPRAZOLE 40' });
      expect(panto).toBeTruthy();
      expect(panto.quantity).toBe(50);
      expect(panto.batch_number).toBe('PAN-B1');
      expect(panto.mrp).toBe(95);
      expect(panto.barcode).toBeDefined();

      // Verify existing product update
      const doloAfter = await Inventory.findOne({ 
        medicine_name: 'DOLO 650', 
        batch_number: 'B001' 
      });
      // Existing quantity was 100, payload adds 25
      expect(doloAfter.quantity).toBe(125);
    });

    it('should correctly handle duplicate batches in the same payload', async () => {
      // Create a payload with duplicate batches
      const payload = {
        purchaseId: IDS.store.toString(),
        items: [
          {
            medicine_name: 'PARACETAMOL 500',
            mrp: 10,
            quantity: 30,
            batch_number: 'PARA-DUPE',
          },
          {
            medicine_name: 'PARACETAMOL 500',
            mrp: 10,
            quantity: 20, // duplicate batch!
            batch_number: 'PARA-DUPE',
          }
        ]
      };

      const res = await request(app)
        .post('/api/v1/product/auto-import/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // With the new bulk operations logic, duplicates in the payload are merged in memory
      // before writing. So it counts as 1 new product and 0 updated products.
      expect(res.body.new_products).toBe(1);
      expect(res.body.updated_products).toBe(0);

      // Verify DB merged them
      const para = await Inventory.find({ medicine_name: 'PARACETAMOL 500' });
      expect(para).toHaveLength(1);
      expect(para[0].quantity).toBe(50); // 30 + 20
    });

    it('should reject invalid items format', async () => {
      const res = await request(app)
        .post('/api/v1/product/auto-import/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ purchaseId: IDS.store.toString(), items: 'not-an-array' }); // Invalid format

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/Invalid items format/);
    });

    it('should skip items without medicine_name', async () => {
      const payload = {
        purchaseId: IDS.store.toString(),
        items: [
          {
            mrp: 50,
            quantity: 100,
            batch_number: 'NO-NAME',
          }
        ]
      };

      const res = await request(app)
        .post('/api/v1/product/auto-import/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send(payload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.new_products).toBe(0);
      expect(res.body.updated_products).toBe(0);
    });
  });
});
