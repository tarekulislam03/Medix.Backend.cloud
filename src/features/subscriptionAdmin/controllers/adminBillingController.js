import StoreSubscription from "../../billing/models/storeSubscriptionModel.js";
import Store from "../../store/models/storeModel.js";

// Setup or update a store's subscription
export const setupSubscription = async (req, res) => {
  try {
    const { storeId, planType, totalAmount, downpayment, timelineMonths, schedules, upiId, warningDays, blockDays } = req.body;

    if (!storeId || !planType || !totalAmount || !schedules) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    let subscription = await StoreSubscription.findOne({ storeId });

    if (subscription) {
      subscription.planType = planType;
      subscription.totalAmount = totalAmount;
      subscription.downpayment = downpayment;
      subscription.timelineMonths = timelineMonths;
      subscription.schedules = schedules;
      if (upiId !== undefined) subscription.upiId = upiId;
      if (warningDays !== undefined) subscription.warningDays = warningDays;
      if (blockDays !== undefined) subscription.blockDays = blockDays;
      await subscription.save();
    } else {
      subscription = new StoreSubscription({
        storeId,
        planType,
        totalAmount,
        downpayment,
        timelineMonths,
        schedules,
        upiId: upiId || "",
        warningDays: warningDays !== undefined ? warningDays : 5,
        blockDays: blockDays !== undefined ? blockDays : 10
      });
      await subscription.save();
    }

    res.status(200).json({ message: "Subscription setup successfully", subscription });
  } catch (error) {
    console.error("Setup subscription error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Get all stores with pending UTR approvals (status = 'uploaded')
export const getPendingApprovals = async (req, res) => {
  try {
    const subscriptions = await StoreSubscription.find({
      "schedules.status": "uploaded"
    }).populate("storeId", "storeName contactNumber");

    // Filter schedules to only send the uploaded ones for approval
    const pendingList = [];
    subscriptions.forEach(sub => {
      sub.schedules.forEach(schedule => {
        if (schedule.status === "uploaded") {
          pendingList.push({
            subscriptionId: sub._id,
            storeId: sub.storeId._id,
            storeName: sub.storeId.storeName,
            contactNumber: sub.storeId.contactNumber,
            scheduleId: schedule._id,
            amount: schedule.amount,
            dueDate: schedule.dueDate,
            utrNumber: schedule.utrNumber
          });
        }
      });
    });

    res.status(200).json({ pendingApprovals: pendingList });
  } catch (error) {
    console.error("Get pending approvals error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Approve a specific payment schedule
export const approvePayment = async (req, res) => {
  try {
    const { subscriptionId, scheduleId } = req.body;

    if (!subscriptionId || !scheduleId) {
      return res.status(400).json({ message: "Missing subscriptionId or scheduleId" });
    }

    const subscription = await StoreSubscription.findById(subscriptionId);
    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    const schedule = subscription.schedules.id(scheduleId);
    if (!schedule) {
      return res.status(404).json({ message: "Schedule not found" });
    }

    schedule.status = "paid";
    schedule.paidDate = new Date();

    await subscription.save();

    res.status(200).json({ message: "Payment approved successfully" });
  } catch (error) {
    console.error("Approve payment error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Get all subscriptions for admin view
export const getAllSubscriptions = async (req, res) => {
  try {
    const subscriptions = await StoreSubscription.find().populate("storeId", "storeName contactNumber");
    res.status(200).json({ subscriptions });
  } catch (error) {
    console.error("Get all subscriptions error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Get all stores for the setup dropdown
export const getAllStores = async (req, res) => {
  try {
    const stores = await Store.find({}, "storeName contactNumber email isTrial trialStartDate trialEndDate mercyEndDate isBlocked createdAt");
    res.status(200).json({ stores });
  } catch (error) {
    console.error("Get all stores error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Mark entire subscription as fully paid
export const markAllPaid = async (req, res) => {
  try {
    const { storeId } = req.params;
    const subscription = await StoreSubscription.findOne({ storeId });
    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    subscription.schedules.forEach(schedule => {
      if (schedule.status !== "paid") {
        schedule.status = "paid";
        schedule.paidDate = new Date();
      }
    });

    await subscription.save();
    res.status(200).json({ message: "Store marked as fully paid successfully" });
  } catch (error) {
    console.error("Mark all paid error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Delete a subscription completely
export const deleteSubscription = async (req, res) => {
  try {
    const { storeId } = req.params;
    const subscription = await StoreSubscription.findOneAndDelete({ storeId });
    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }
    res.status(200).json({ message: "Subscription deleted successfully" });
  } catch (error) {
    console.error("Delete subscription error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Add a custom payment alert schedule to a store
export const addCustomAlert = async (req, res) => {
  try {
    const { storeId, amount, dueDate, upiId, warningDays, blockDays } = req.body;

    if (!storeId || !amount || !dueDate) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    let subscription = await StoreSubscription.findOne({ storeId });

    if (!subscription) {
      // Create a dummy subscription to hold the custom alert
      subscription = new StoreSubscription({
        storeId,
        planType: "full_payment",
        totalAmount: 0,
        schedules: []
      });
    }

    subscription.schedules.push({
      amount,
      dueDate,
      status: "pending",
      isCustom: true,
      upiId: upiId || "",
      warningDays: warningDays !== undefined ? warningDays : 5,
      blockDays: blockDays !== undefined ? blockDays : 10
    });

    await subscription.save();
    res.status(200).json({ message: "Custom alert added successfully", subscription });
  } catch (error) {
    console.error("Add custom alert error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Remove pending custom alerts for a store
export const removeCustomAlert = async (req, res) => {
  try {
    const { storeId } = req.params;
    const subscription = await StoreSubscription.findOne({ storeId });
    if (!subscription) {
      return res.status(404).json({ message: "Subscription not found" });
    }

    // Filter out pending custom alerts
    subscription.schedules = subscription.schedules.filter(
      s => !(s.isCustom && s.status !== "paid")
    );
    await subscription.save();

    res.status(200).json({ message: "Custom alert removed successfully" });
  } catch (error) {
    console.error("Remove custom alert error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Toggle Trial Status for a Store
export const toggleTrial = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { isTrial, startDate, endDate, mercyEndDate } = req.body;

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    if (isTrial) {
      store.isTrial = true;
      store.trialStartDate = startDate ? new Date(startDate) : new Date();
      store.trialEndDate = endDate ? new Date(endDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      store.mercyEndDate = mercyEndDate ? new Date(mercyEndDate) : null;
    } else {
      store.isTrial = false;
      store.trialStartDate = null;
      store.trialEndDate = null;
      store.mercyEndDate = null;
    }

    await store.save();
    res.status(200).json({ message: `Trial ${isTrial ? 'activated' : 'deactivated'} successfully`, store });
  } catch (error) {
    console.error("Toggle trial error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Toggle Block Status for a Store
export const toggleBlock = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { isBlocked } = req.body;

    const store = await Store.findById(storeId);
    if (!store) {
      return res.status(404).json({ message: "Store not found" });
    }

    store.isBlocked = isBlocked;
    await store.save();

    res.status(200).json({ message: `Store ${isBlocked ? 'blocked' : 'unblocked'} successfully`, store });
  } catch (error) {
    console.error("Toggle block error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// Platform Revenue Overview — for admin performance dashboard
export const getPlatformRevenue = async (req, res) => {
  try {
    const subscriptions = await StoreSubscription.find({}, "totalAmount schedules createdAt").lean();

    let totalRevenue = 0;
    let collectedRevenue = 0;
    let pendingRevenue = 0;

    // Monthly collected map: { "YYYY-MM": amount }
    const monthlyCollected = {};

    subscriptions.forEach((sub) => {
      totalRevenue += sub.totalAmount || 0;

      (sub.schedules || []).forEach((sch) => {
        if (sch.status === "paid") {
          collectedRevenue += sch.amount || 0;

          if (sch.paidDate) {
            const key = new Date(sch.paidDate).toISOString().slice(0, 7); // "YYYY-MM"
            monthlyCollected[key] = (monthlyCollected[key] || 0) + (sch.amount || 0);
          }
        } else {
          pendingRevenue += sch.amount || 0;
        }
      });
    });

    // Sort monthly data last 12 months
    const monthlyData = Object.entries(monthlyCollected)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, amount]) => ({ month, amount }));

    const totalStores = subscriptions.length;
    const paidStores = subscriptions.filter((s) =>
      s.schedules?.every((sch) => sch.status === "paid")
    ).length;

    res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        collectedRevenue,
        pendingRevenue,
        monthlyData,
        totalStores,
        paidStores,
      },
    });
  } catch (error) {
    console.error("Platform revenue error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
