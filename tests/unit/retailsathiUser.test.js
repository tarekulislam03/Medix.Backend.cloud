import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { connectTestDB, disconnectTestDB, clearTestDB, setTestEnv } from '../setup/testHelpers.js';
import RetailSathiUser from '../../src/features/retailsathi/models/RetailSathiUser.js';

describe('RetailSathiUser Model Unit Tests', () => {
  beforeAll(async () => {
    setTestEnv();
    await connectTestDB();
  });

  afterAll(async () => {
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  it('should create a RetailSathiUser and automatically hash the password', async () => {
    const rawPassword = 'mySecretPassword123';
    const user = await RetailSathiUser.create({
      username: 'unit_test_user',
      password: rawPassword,
      name: 'Unit Test User',
      role: 'cashier',
      phone: '1234567890'
    });

    expect(user._id).toBeDefined();
    expect(user.username).toBe('unit_test_user');
    expect(user.password).not.toBe(rawPassword); // Password should be hashed
    expect(user.password).toMatch(/^\$2[ayb]\$/); // bcrypt hash format
    expect(user.isActive).toBe(true);
    expect(user.role).toBe('cashier');
  });

  it('should correctly compare valid and invalid passwords via comparePassword method', async () => {
    const password = 'correctPassword456';
    const user = await RetailSathiUser.create({
      username: 'compare_test_user',
      password,
      name: 'Compare User',
      role: 'admin'
    });

    const isMatchCorrect = await user.comparePassword('correctPassword456');
    const isMatchIncorrect = await user.comparePassword('wrongPassword');

    expect(isMatchCorrect).toBe(true);
    expect(isMatchIncorrect).toBe(false);
  });

  it('should trim and lowercase username on save', async () => {
    const user = await RetailSathiUser.create({
      username: '   MyUserNAME   ',
      password: 'password123',
      name: 'Trim Test User'
    });

    expect(user.username).toBe('myusername');
  });

  it('should throw validation error if required fields are missing', async () => {
    const userWithoutPassword = new RetailSathiUser({
      username: 'nopassword',
      name: 'No Password'
    });

    let err;
    try {
      await userWithoutPassword.save();
    } catch (error) {
      err = error;
    }

    expect(err).toBeDefined();
    expect(err.errors.password).toBeDefined();
  });

  it('should throw validation error for invalid role enum', async () => {
    const invalidRoleUser = new RetailSathiUser({
      username: 'superrole',
      password: 'password123',
      name: 'Invalid Role User',
      role: 'superadmin' // invalid role
    });

    let err;
    try {
      await invalidRoleUser.save();
    } catch (error) {
      err = error;
    }

    expect(err).toBeDefined();
    expect(err.errors.role).toBeDefined();
  });
});
