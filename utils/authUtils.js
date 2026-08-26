const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'homesolutionsupersecretjwtkey';

// Helper function to hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Token Generator Helper (90-second short lived access token + 7-day refresh token)
function generateAuthTokens(userPayload) {
  const token = jwt.sign(
    { email: userPayload.email, name: userPayload.name, role: userPayload.role, id: userPayload.id },
    JWT_SECRET,
    { expiresIn: '90s' } // Short-lived access token (90 seconds)
  );

  const refreshToken = jwt.sign(
    { email: userPayload.email, id: userPayload.id, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: '7d' } // Long-lived refresh token (7 days)
  );

  return { token, refreshToken };
}

module.exports = {
  JWT_SECRET,
  hashPassword,
  generateAuthTokens
};
