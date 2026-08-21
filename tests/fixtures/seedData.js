import mongoose from 'mongoose';

const { ObjectId } = mongoose.Types;

// ──────────────────────────────────────────────────────────────────────────────
// Stable ObjectIds for referential integrity across fixtures
// ──────────────────────────────────────────────────────────────────────────────
export const IDS = {
  store:      new ObjectId(),
  user:       new ObjectId(),
  customer1:  new ObjectId(),
  customer2:  new ObjectId(),
  product1:   new ObjectId(),
  product2:   new ObjectId(),
  product3:   new ObjectId(),
  product4:   new ObjectId(),
  product5:   new ObjectId(),
};

// ──────────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────────
export const storeData = {
  _id: IDS.store,
  storeName: 'Medix Test Pharmacy',
  email: 'test@medix.com',
  password: 'hashedpassword123',
  address: '123 Test Street',
  contactNumber: '9876543210',
};

// ──────────────────────────────────────────────────────────────────────────────
// User
// ──────────────────────────────────────────────────────────────────────────────
export const userData = {
  _id: IDS.user,
  phone: '9876543210',
  password: '$2a$10$abcdefghijklmnopqrstuv', // bcrypt hash placeholder
  storeId: IDS.store,
};

// ──────────────────────────────────────────────────────────────────────────────
// Customers
// ──────────────────────────────────────────────────────────────────────────────
export const customers = [
  {
    _id: IDS.customer1,
    name: 'Rahul Sharma',
    phone_no: '9111111111',
    credit_balance: 500,
    storeId: IDS.store,
  },
  {
    _id: IDS.customer2,
    name: 'Priya Patel',
    phone_no: '9222222222',
    credit_balance: 0,
    storeId: IDS.store,
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Products (Inventory)
// Simulates: 2 batches of same medicine (FEFO), 1 unique, 1 loose-capable, 1 no-batch
// ──────────────────────────────────────────────────────────────────────────────
export const products = [
  {
    _id: IDS.product1,
    medicine_name: 'DOLO 650',
    mrp: 30,
    quantity: 100,
    cost_price: 20,
    barcode: 'DOLO650-1718700000-001',
    short_barcode: '100001',
    batch_number: 'B001',
    expiry_date: new Date('2026-03-15'), // expires sooner (FEFO priority)
    supplier_name: 'Micro Labs',
    tablets_per_strip: 15,
    hsn_code: '30049099',
    gst: 12,
    alert_threshold: 10,
    storeId: IDS.store,
  },
  {
    _id: IDS.product2,
    medicine_name: 'DOLO 650',
    mrp: 30,
    quantity: 50,
    cost_price: 20,
    barcode: 'DOLO650-1718700000-002',
    short_barcode: '100002',
    batch_number: 'B002',
    expiry_date: new Date('2027-06-20'), // expires later
    supplier_name: 'Micro Labs',
    tablets_per_strip: 15,
    hsn_code: '30049099',
    gst: 12,
    alert_threshold: 10,
    storeId: IDS.store,
  },
  {
    _id: IDS.product3,
    medicine_name: 'AZITHROMYCIN 500',
    mrp: 120,
    quantity: 30,
    cost_price: 80,
    barcode: 'AZITHROMYCIN500-1718700000-003',
    short_barcode: '100003',
    batch_number: 'AZ-B1',
    expiry_date: new Date('2027-01-10'),
    supplier_name: 'Cipla',
    tablets_per_strip: 3,
    hsn_code: '30049099',
    gst: 12,
    alert_threshold: 5,
    storeId: IDS.store,
  },
  {
    _id: IDS.product4,
    medicine_name: 'CROCIN ADVANCE',
    mrp: 25,
    quantity: 200,
    cost_price: 15,
    barcode: 'CROCINADVANCE-1718700000-004',
    short_barcode: '100004',
    batch_number: '', // no batch number — should NOT be auto-deleted at zero stock
    expiry_date: null,
    supplier_name: 'GSK',
    tablets_per_strip: 15,
    hsn_code: '30049099',
    gst: 5,
    alert_threshold: 20,
    storeId: IDS.store,
  },
  {
    _id: IDS.product5,
    medicine_name: 'AMOXICILLIN 250',
    mrp: 85,
    quantity: 5,
    cost_price: 50,
    barcode: 'AMOXICILLIN250-1718700000-005',
    short_barcode: '100005',
    batch_number: 'AMX-B1',
    expiry_date: new Date('2025-12-01'), // already expired
    supplier_name: 'Ranbaxy',
    tablets_per_strip: 10,
    hsn_code: '30049099',
    gst: 12,
    alert_threshold: 2,
    storeId: IDS.store,
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Sample checkout payloads
// ──────────────────────────────────────────────────────────────────────────────
export const checkoutPayloads = {
  singleItemCash: {
    items: [
      { product_id: IDS.product1.toString(), quantity: 2, discount_percent: 0 },
    ],
    payment_method: 'cash',
    amount_paid: 60,
  },

  multiItemCash: {
    items: [
      { product_id: IDS.product1.toString(), quantity: 3, discount_percent: 10 },
      { product_id: IDS.product3.toString(), quantity: 1, discount_percent: 5 },
    ],
    payment_method: 'cash',
    amount_paid: 200,
  },

  creditSale: {
    items: [
      { product_id: IDS.product3.toString(), quantity: 2, discount_percent: 0 },
    ],
    payment_method: 'cash',
    amount_paid: 100,
    customer_id: IDS.customer1.toString(),
  },

  withDoctorFeeAndOtc: {
    items: [
      { product_id: IDS.product4.toString(), quantity: 5, discount_percent: 0 },
    ],
    payment_method: 'upi',
    amount_paid: 200,
    doctor_fee: 50,
    otc_items: [{ name: 'Bandage', price: 20 }],
  },

  insufficientStock: {
    items: [
      { product_id: IDS.product5.toString(), quantity: 999, discount_percent: 0 },
    ],
    payment_method: 'cash',
    amount_paid: 999999,
  },

  emptyCart: {
    items: [],
    payment_method: 'cash',
    amount_paid: 0,
  },
};

// ──────────────────────────────────────────────────────────────────────────────
// AI Import confirm payload
// ──────────────────────────────────────────────────────────────────────────────
export const autoImportConfirmPayload = {
  purchaseId: new ObjectId().toString(),
  items: [
    {
      medicine_name: 'PANTOPRAZOLE 40',
      mrp: 95,
      quantity: 50,
      batch_number: 'PAN-B1',
      expiry_date: '2027-08-15',
      cost_price: 60,
      hsn_code: '30049099',
      gst: 12,
    },
    {
      medicine_name: 'DOLO 650', // existing — should update qty
      mrp: 30,
      quantity: 25,
      batch_number: 'B001',
      expiry_date: '2026-03-15',
      cost_price: 20,
    },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// Helper: seed the full database
// ──────────────────────────────────────────────────────────────────────────────
export async function seedDatabase(models) {
  const { Store, User, Customer, Inventory } = models;
  await Store.create(storeData);
  await User.create(userData);
  await Customer.insertMany(customers);
  await Inventory.insertMany(products);
}
