import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import User from "../../src/features/user/models/userModel.js";
import userRouter from "../../src/features/user/routes/userRoutes.js";

describe("User Total Count API", () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/api/v1/user", userRouter);
  });

  it("should return total users count from MongoDB and Supabase", async () => {
    jest.spyOn(User, "countDocuments").mockResolvedValue(10);

    const res = await request(app).get("/api/v1/user/total-users");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.mongodb.count).toBe(10);
    expect(res.body.data.totalUsers).toBe(10);
  });

  it("should also be accessible via /count alias", async () => {
    jest.spyOn(User, "countDocuments").mockResolvedValue(5);

    const res = await request(app).get("/api/v1/user/count");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mongodb.count).toBe(5);
  });
});
