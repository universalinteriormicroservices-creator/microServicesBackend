const test = require('node:test');
const assert = require('node:assert/strict');
const { sendEmailOtp, verifyEmailOtp, _otpStore } = require('../controllers/authController');
const emailService = require('../utils/emailService');

// Mock helper to create mock Express req and res
function createMockContext(body = {}) {
  const req = { body };
  const res = {
    statusCode: 200,
    data: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.data = payload;
      return this;
    }
  };
  return { req, res };
}

test('Email OTP Service & Base Sender Configuration', async (t) => {
  await t.test('Base sender email is universalinteriormicroservices@gmail.com', () => {
    assert.equal(emailService.BASE_EMAIL, 'universalinteriormicroservices@gmail.com');
  });

  await t.test('Branded HTML email template contains OTP and contact details', () => {
    const html = emailService.getOtpEmailHtml('789456');
    assert.match(html, /789456/, 'Template should contain the 6-digit OTP code');
    assert.match(html, /universalinteriormicroservices@gmail\.com/, 'Template should contain base email address');
    assert.match(html, /5 minutes/, 'Template should state 5 minutes validity');
  });

  await t.test('Email dispatch helper returns success with clean email', async () => {
    const result = await emailService.sendEmailOtp('test.customer@example.com', '123456');
    assert.equal(result.success, true);
    assert.match(result.message, /test\.customer@example\.com/);
  });
});

test('Email OTP Request (sendEmailOtp)', async (t) => {
  await t.test('Rejects request with missing email address', async () => {
    const { req, res } = createMockContext({});
    await sendEmailOtp(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.data.error, 'Valid email address is required');
  });

  await t.test('Rejects request with invalid email format', async () => {
    const { req, res } = createMockContext({ email: 'not-an-email' });
    await sendEmailOtp(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.data.error, 'Please enter a valid email address');
  });

  await t.test('Successfully generates 6-digit OTP and stores it for valid email', async () => {
    const testEmail = 'newcustomer@universaltest.com';
    _otpStore.delete(testEmail);

    const { req, res } = createMockContext({ email: testEmail });
    await sendEmailOtp(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.email, testEmail);
    assert.equal(res.data.expiresIn, 300);
    assert.match(res.data.demoOtp, /^\d{6}$/, 'Generated OTP must be exactly 6 numeric digits');

    // Check in-memory store
    const stored = _otpStore.get(testEmail);
    assert.ok(stored, 'Record must exist in OTP store');
    assert.equal(stored.otp, res.data.demoOtp);
    assert.ok(stored.expiresAt > Date.now(), 'expiresAt must be in the future');
    assert.equal(stored.attempts, 0);

    // Clean up
    _otpStore.delete(testEmail);
  });
});

test('Email OTP Verification (verifyEmailOtp)', async (t) => {
  const testEmail = 'verifytest@universaltest.com';

  await t.test('Rejects missing email or OTP', async () => {
    const { req: req1, res: res1 } = createMockContext({ email: testEmail });
    await verifyEmailOtp(req1, res1);
    assert.equal(res1.statusCode, 400);

    const { req: req2, res: res2 } = createMockContext({ otp: '123456' });
    await verifyEmailOtp(req2, res2);
    assert.equal(res2.statusCode, 400);
  });

  await t.test('Rejects non-existent OTP request', async () => {
    _otpStore.delete('nonexistent@universaltest.com');
    const { req, res } = createMockContext({ email: 'nonexistent@universaltest.com', otp: '999999' });
    await verifyEmailOtp(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.data.error, /No active OTP found/);
  });

  await t.test('Rejects invalid OTP code and increments attempts', async () => {
    _otpStore.set(testEmail, {
      otp: '654321',
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0
    });

    const { req, res } = createMockContext({ email: testEmail, otp: '111111' });
    await verifyEmailOtp(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.data.error, /Invalid OTP code/);

    const updatedRecord = _otpStore.get(testEmail);
    assert.equal(updatedRecord.attempts, 1);
  });

  await t.test('Enforces rate limiting after 5 failed attempts', async () => {
    _otpStore.set(testEmail, {
      otp: '654321',
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 5 // 5 previous attempts
    });

    const { req, res } = createMockContext({ email: testEmail, otp: '111111' });
    await verifyEmailOtp(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.data.error, /Too many invalid attempts/);
    assert.equal(_otpStore.get(testEmail), undefined, 'Record must be deleted after excessive attempts');
  });

  await t.test('Rejects expired OTP codes', async () => {
    _otpStore.set(testEmail, {
      otp: '654321',
      expiresAt: Date.now() - 1000, // expired 1s ago
      attempts: 0
    });

    const { req, res } = createMockContext({ email: testEmail, otp: '654321' });
    await verifyEmailOtp(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.data.error, /OTP code has expired/);
    assert.equal(_otpStore.get(testEmail), undefined, 'Expired record must be deleted');
  });

  await t.test('Successfully verifies valid OTP code and deletes from store (single-use)', async () => {
    _otpStore.set(testEmail, {
      otp: '456789',
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0
    });

    const { req, res } = createMockContext({ email: testEmail, otp: '456789' });
    await verifyEmailOtp(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.verified, true);
    assert.match(res.data.message, /verified successfully/);

    // Must be deleted to prevent reuse
    assert.equal(_otpStore.get(testEmail), undefined, 'OTP must be single-use and deleted on success');
  });

  await t.test('Supports master bypass code for testing', async () => {
    const { req, res } = createMockContext({ email: 'mastertest@universaltest.com', otp: '123456' });
    await verifyEmailOtp(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.verified, true);
  });
});
