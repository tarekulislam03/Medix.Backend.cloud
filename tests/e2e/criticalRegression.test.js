import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../src/app.js';
import { connectTestDB, disconnectTestDB, clearTestDB, generateTestToken, setTestEnv } from '../setup/testHelpers.js';
import { IDS, seedDatabase } from '../fixtures/seedData.js';
import Store from '../../src/features/store/models/storeModel.js';
import User from '../../src/features/user/models/userModel.js';
import Customer from '../../src/features/customer/models/customerModel.js';
import Inventory from '../../src/features/product/models/productModel.js';

describe('Critical Flows Regression E2E', () => {
    let token;
    let createdProductId;
    let createdSaleId;

    beforeAll(async () => {
        setTestEnv();
        await connectTestDB();
        await clearTestDB();
        await seedDatabase({ Store, User, Customer, Inventory });
        token = generateTestToken(IDS.user, IDS.store);
    });

    afterAll(async () => {
        await disconnectTestDB();
    });

    it('Step 1: Should create a new product', async () => {
        // Arrange
        const productPayload = {
            medicine_name: "E2E_TEST_MEDICINE",
            mrp: 100,
            quantity: 50,
            cost_price: 80,
            batch_number: "E2E-B1",
            expiry_date: "2028-12-31",
            hsn_code: "123456",
            gst: 12,
            tablets_per_strip: 10
        };

        // Act
        const res = await request(app)
            .post('/api/v1/product/create')
            .set('Authorization', `Bearer ${token}`)
            .send(productPayload);

        // Assert
        expect(res.status).toBe(201);
        expect(res.body.data).toBeDefined();
        createdProductId = res.body.data._id;
        expect(res.body.data.medicine_name).toBe("E2E_TEST_MEDICINE");
        
        // Verify in DB
        const product = await Inventory.findById(createdProductId);
        expect(product.quantity).toBe(50);
        expect(product.storeId.toString()).toBe(IDS.store.toString());
    });

    it('Step 2: Should checkout with the created product', async () => {
        // Arrange
        // Subtotal = 100 * 10 = 1000
        // Discount = 10% = 100
        // Total = 900
        const checkoutPayload = {
            items: [
                { product_id: createdProductId, quantity: 10, discount_percent: 10 }
            ],
            payment_method: "cash",
            amount_paid: 900
        };

        // Act
        const res = await request(app)
            .post('/api/v1/billing/checkout')
            .set('Authorization', `Bearer ${token}`)
            .send(checkoutPayload);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body.invoice).toBeDefined();
        createdSaleId = res.body.invoice._id;
        
        expect(res.body.invoice.grand_total).toBe(900);
        
        // Check DB product quantity
        const product = await Inventory.findById(createdProductId);
        expect(product.quantity).toBe(40); // 50 - 10
    });

    it('Step 3: Should edit the sale and update inventory correctly', async () => {
        // Arrange
        // Change quantity from 10 to 5
        // Subtotal = 100 * 5 = 500
        // Discount = 10% = 50
        // Total = 450
        const editSalePayload = {
            items: [
                { product_id: createdProductId, quantity: 5, discount_percent: 10 }
            ],
            payment_method: "cash",
            amount_paid: 450
        };

        // Act
        const res = await request(app)
            .put(`/api/v1/sales/history/${createdSaleId}`)
            .set('Authorization', `Bearer ${token}`)
            .send(editSalePayload);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body.data.grand_total).toBe(450);

        // Check DB product quantity. Original 50. Sold 10 -> 40. Edited to 5 -> 45.
        const product = await Inventory.findById(createdProductId);
        expect(product.quantity).toBe(45);
    });

    it('Step 4: Should auto import and update existing inventory / insert new', async () => {
        // Arrange
        const importPayload = {
            purchaseId: IDS.store.toString(),
            items: [
                {
                    medicine_name: "E2E_TEST_MEDICINE", // Same name
                    mrp: 100,
                    quantity: 20, // Add 20 more
                    batch_number: "E2E-B1", // Same batch
                    expiry_date: "2028-12-31",
                    cost_price: 80,
                    hsn_code: "123456",
                    gst: 12
                },
                {
                    medicine_name: "NEW_IMPORT_MED",
                    mrp: 50,
                    quantity: 100,
                    batch_number: "NEW-B1",
                    expiry_date: "2029-01-01",
                    cost_price: 30,
                    hsn_code: "999999",
                    gst: 5
                }
            ]
        };

        // Act
        const res = await request(app)
            .post('/api/v1/product/auto-import/confirm')
            .set('Authorization', `Bearer ${token}`)
            .send(importPayload);

        // Assert
        expect(res.status).toBe(200);
        
        // E2E product should now be 45 + 20 = 65
        const updatedE2E = await Inventory.findById(createdProductId);
        expect(updatedE2E.quantity).toBe(65);

        // New product should exist
        const newProduct = await Inventory.findOne({ medicine_name: "NEW_IMPORT_MED", storeId: IDS.store });
        expect(newProduct).toBeDefined();
        expect(newProduct.quantity).toBe(100);
    });
});
