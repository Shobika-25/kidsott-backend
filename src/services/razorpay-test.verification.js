"use strict";

// KIDSOTT_RZ15A_TEST_VERIFICATION_V1
// Isolated Razorpay TEST payment verification.
// Never modify production subscription purchases or entitlements.

const {
  requireApprovedTestAccount,
} = require("./razorpay-test.eligibility");

const {
  verifyCapturedTestPayment,
} = require("./razorpay-test.gateway");

function validateStoredOrder(row, userId, orderId, paymentId) {
  if (
    !row ||
    !Number.isSafeInteger(Number(row.id)) ||
    Number(row.id) <= 0 ||
    Number(row.user_id) !== userId ||
    row.razorpay_order_id !== orderId ||
    row.provider !== "razorpay_test" ||
    row.currency !== "INR" ||
    !Number.isSafeInteger(Number(row.amount_paise)) ||
    Number(row.amount_paise) <= 0 ||
    !["monthly", "yearly"].includes(row.plan_code)
  ) {
    throw new Error("Invalid or missing stored test order.");
  }

  if (
    row.status !== "created" &&
    row.status !== "verified"
  ) {
    throw new Error("Test order is not verifiable.");
  }

  if (
    row.status === "created" &&
    row.razorpay_payment_id != null
  ) {
    throw new Error("Conflicting test payment state.");
  }

  if (
    row.status === "verified" &&
    (
      row.razorpay_payment_id !== paymentId ||
      !row.signature_verified_at ||
      !row.captured_verified_at
    )
  ) {
    throw new Error(
      "Test order was verified for another payment."
    );
  }
}

async function verifyAndRecordRazorpayTestPayment({
  db,
  userId,
  orderId,
  paymentId,
  signature,
  verifyPayment = verifyCapturedTestPayment,
}) {
  // Fail closed unless Test Mode and the account are approved.
  const approvedUserId = requireApprovedTestAccount(userId);

  if (
    !/^order_[A-Za-z0-9]+$/.test(orderId) ||
    !/^pay_[A-Za-z0-9]+$/.test(paymentId) ||
    !/^[a-fA-F0-9]{64}$/.test(signature)
  ) {
    throw new Error("Invalid Razorpay test payment fields.");
  }

  if (
    !db ||
    typeof db.query !== "function" ||
    typeof db.getConnection !== "function"
  ) {
    throw new Error(
      "MySQL transaction-capable pool is required."
    );
  }

  if (typeof verifyPayment !== "function") {
    throw new Error("Payment verification unavailable.");
  }

  // Amount and order ownership come from the database.
  // The mobile app cannot supply a payment amount.
  const [rows] = await db.query(
    `
      SELECT
        id,
        user_id,
        plan_code,
        provider,
        razorpay_order_id,
        razorpay_payment_id,
        amount_paise,
        currency,
        status,
        signature_verified_at,
        captured_verified_at
      FROM razorpay_test_transactions
      WHERE user_id = ?
        AND razorpay_order_id = ?
      LIMIT 1
    `,
    [approvedUserId, orderId]
  );

  const stored = rows[0];

  validateStoredOrder(
    stored,
    approvedUserId,
    orderId,
    paymentId
  );

  const expectedAmountPaise = Number(stored.amount_paise);

  // Existing RZ-03 gateway verifies:
  // - checkout HMAC signature
  // - captured status from Razorpay
  // - order reference, amount and currency
  const verified = await verifyPayment({
    orderId,
    paymentId,
    signature,
    expectedAmountPaise,
  });

  // Fail closed if the gateway contract is inconsistent.
  if (
    !verified ||
    verified.provider !== "razorpay_test" ||
    verified.environment !== "test" ||
    verified.orderId !== orderId ||
    verified.paymentId !== paymentId ||
    Number(verified.amountPaise) !== expectedAmountPaise ||
    verified.currency !== "INR"
  ) {
    throw new Error(
      "Razorpay test payment verification mismatch."
    );
  }

  // Lock the row so duplicate callbacks cannot
  // independently update the same test transaction.
  const connection = await db.getConnection();
  let inTransaction = false;

  try {
    await connection.beginTransaction();
    inTransaction = true;

    const [lockedRows] = await connection.query(
      `
        SELECT
          id,
          user_id,
          plan_code,
          provider,
          razorpay_order_id,
          razorpay_payment_id,
          amount_paise,
          currency,
          status,
          signature_verified_at,
          captured_verified_at
        FROM razorpay_test_transactions
        WHERE id = ?
        FOR UPDATE
      `,
      [stored.id]
    );

    const locked = lockedRows[0];

    validateStoredOrder(
      locked,
      approvedUserId,
      orderId,
      paymentId
    );

    if (
      Number(locked.amount_paise) !== expectedAmountPaise ||
      locked.plan_code !== stored.plan_code
    ) {
      throw new Error(
        "Test order changed during verification."
      );
    }

    if (locked.status === "created") {
      const [update] = await connection.query(
        `
          UPDATE razorpay_test_transactions
          SET
            razorpay_payment_id = ?,
            signature_verified_at = UTC_TIMESTAMP(3),
            captured_verified_at = UTC_TIMESTAMP(3),
            status = 'verified'
          WHERE id = ?
            AND user_id = ?
            AND razorpay_order_id = ?
            AND status = 'created'
            AND razorpay_payment_id IS NULL
        `,
        [
          paymentId,
          stored.id,
          approvedUserId,
          orderId,
        ]
      );

      if (Number(update.affectedRows) !== 1) {
        throw new Error(
          "Test payment was not recorded."
        );
      }
    }

    // If already verified for this payment, do not
    // write again. This makes callbacks idempotent.
    await connection.commit();
    inTransaction = false;

    return Object.freeze({
      provider: "razorpay_test",
      environment: "test",
      orderId,
      paymentId,
      verified: true,
      premiumActivated: false,
    });
  } catch (error) {
    if (inTransaction) {
      try {
        await connection.rollback();
      } catch (_) {
        // Preserve the original failure.
      }
    }

    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  verifyAndRecordRazorpayTestPayment,
};