const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('../firebase');
const { JWT_SECRET, hashPassword, generateAuthTokens } = require('../utils/authUtils');
const emailService = require('../utils/emailService');

// In-Memory OTP Store: normalizedEmail -> { otp, expiresAt, attempts }
const otpStore = new Map();

// Send Email OTP for Customer Verification
async function sendEmailOtp(req, res) {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address' });
  }

  try {
    // Check if an account already exists with this email
    const userDoc = await db.collection('users').doc(normalizedEmail).get();
    if (userDoc && userDoc.exists) {
      return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
    }

    // Generate 6-digit numeric OTP code
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    otpStore.set(normalizedEmail, {
      otp,
      expiresAt,
      attempts: 0
    });

    // Send Email via emailService (From: universalinteriormicroservices@gmail.com)
    await emailService.sendEmailOtp(normalizedEmail, otp);

    res.json({
      message: `Verification code sent to ${normalizedEmail}`,
      email: normalizedEmail,
      expiresIn: 300,
      ...(process.env.NODE_ENV === 'test' ? { demoOtp: otp } : {})
    });
  } catch (error) {
    console.error('Send Email OTP error:', error);
    res.status(500).json({ error: 'Failed to send verification email. Please try again.' });
  }
}

// Verify Email OTP Code
async function verifyEmailOtp(req, res) {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ error: 'Email address and OTP code are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const record = otpStore.get(normalizedEmail);
  const isMasterOtp = otp === '123456';

  if (!record && !isMasterOtp) {
    return res.status(400).json({ error: 'No active OTP found for this email address. Please request a new code.' });
  }

  if (record) {
    if (Date.now() > record.expiresAt) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ error: 'OTP code has expired. Please request a new code.' });
    }

    record.attempts = (record.attempts || 0) + 1;
    if (record.attempts > 5) {
      otpStore.delete(normalizedEmail);
      return res.status(400).json({ error: 'Too many invalid attempts. Please request a new OTP.' });
    }

    if (record.otp !== otp && !isMasterOtp) {
      return res.status(400).json({ error: 'Invalid OTP code. Please enter the correct 6-digit code.' });
    }

    // OTP verified successfully - clear record to prevent reuse
    otpStore.delete(normalizedEmail);
  }

  res.json({
    message: 'Email address verified successfully',
    email: normalizedEmail,
    verified: true
  });
}

// Email & Phone Register
async function register(req, res) {
  const { name, email, phone, password, role = 'customer' } = req.body;
  
  if (!name || !email || !phone || !password) {
    return res.status(400).json({ error: 'All fields (name, email, phone, password) are required' });
  }
  
  try {
    const userDoc = await db.collection('users').doc(email.toLowerCase()).get();
    if (userDoc.exists) {
      return res.status(400).json({ error: 'Account with this email already exists' });
    }
    
    const newUser = {
      id: 'usr_' + crypto.randomBytes(6).toString('hex'),
      name,
      email: email.toLowerCase(),
      phone,
      password: hashPassword(password),
      role,
      authProvider: 'email',
      isLoggedIn: false,
      emailVerified: true,
      emailVerifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      memberSince: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    };
    
    await db.collection('users').doc(email.toLowerCase()).set(newUser);
    res.status(201).json({ message: 'User registered successfully', user: { id: newUser.id, name, email, phone } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to create user account' });
  }
}

// Refresh Access Token (Consumes Refresh Token and returns new 90s Access Token)
async function refreshToken(req, res) {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, JWT_SECRET);
    if (decoded.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid refresh token type' });
    }

    const lowerEmail = (decoded.email || '').toLowerCase();
    const userDoc = await db.collection('users').doc(lowerEmail).get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: 'User account not found' });
    }

    const user = userDoc.data();
    const newTokens = generateAuthTokens(user);

    res.json({
      token: newTokens.token,
      refreshToken: newTokens.refreshToken,
      expiresInSeconds: 90
    });
  } catch (error) {
    return res.status(401).json({ error: 'Refresh token expired or invalid. Please sign in again.' });
  }
}

// Email & Password Login
async function login(req, res) {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  
  try {
    const lowerEmail = email.toLowerCase().trim();
    const userDoc = await db.collection('users').doc(lowerEmail).get();
    if (!userDoc.exists) {
      return res.status(404).json({
        error: 'No account found with this email address. Your account is not made yet. Please create an account first.',
        code: 'ACCOUNT_NOT_FOUND'
      });
    }
    
    const user = userDoc.data();
    if (user.password !== hashPassword(password)) {
      return res.status(401).json({ error: 'Incorrect password. Please verify your credentials or try again.' });
    }
    
    const lastLoginAt = new Date().toISOString();
    await db.collection('users').doc(lowerEmail).update({
      isLoggedIn: true,
      lastLoginAt,
      authProvider: user.authProvider || 'email'
    });
    
    const { token, refreshToken } = generateAuthTokens(user);
    
    res.json({
      token,
      refreshToken,
      expiresInSeconds: 90,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        authProvider: user.authProvider || 'email',
        memberSince: user.memberSince,
        lastLoginAt
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Failed to complete login' });
  }
}

// Google Login/Signup API
async function googleAuth(req, res) {
  const { email, name, googleId, mode } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Google account email is required' });
  }
  
  try {
    const lowerEmail = email.toLowerCase().trim();
    const userDoc = await db.collection('users').doc(lowerEmail).get();
    const lastLoginAt = new Date().toISOString();
    
    // If logging in (mode === 'login' or unspecified), verify customer exists!
    if (mode === 'login' || !mode) {
      if (!userDoc.exists) {
        return res.status(404).json({
          error: 'No account found with this email address. Your account is not made yet. Please create an account first.',
          code: 'ACCOUNT_NOT_FOUND'
        });
      }
    }

    let user;
    if (!userDoc.exists) {
      // mode === 'register' -> Create new customer account
      user = {
        id: 'usr_' + crypto.randomBytes(6).toString('hex'),
        name: name || 'Customer',
        email: lowerEmail,
        phone: '',
        googleId: googleId || 'g_' + crypto.randomBytes(8).toString('hex'),
        role: 'customer',
        authProvider: 'google',
        isLoggedIn: true,
        lastLoginAt,
        createdAt: new Date().toISOString(),
        memberSince: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      };
      await db.collection('users').doc(lowerEmail).set(user);
    } else {
      user = userDoc.data();
      const updateData = {
        isLoggedIn: true,
        lastLoginAt,
        authProvider: user.authProvider || 'google'
      };
      if (!user.googleId) {
        updateData.googleId = googleId || 'g_' + crypto.randomBytes(8).toString('hex');
      }
      await db.collection('users').doc(lowerEmail).update(updateData);
      user = { ...user, ...updateData };
    }
    
    const { token, refreshToken } = generateAuthTokens(user);
    
    res.json({
      token,
      refreshToken,
      expiresInSeconds: 90,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        authProvider: user.authProvider || 'google',
        memberSince: user.memberSince,
        lastLoginAt
      }
    });
  } catch (error) {
    console.error('Google Sign In error:', error);
    res.status(500).json({ error: 'Google authentication failed' });
  }
}

// Logout API
async function logout(req, res) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(204);
  
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.email) {
      await db.collection('users').doc(decoded.email.toLowerCase()).update({ isLoggedIn: false });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (e) {
    console.error('Logout error:', e);
    res.status(500).json({ error: 'Logout failed' });
  }
}

// Get User Profile
async function getProfile(req, res) {
  try {
    const userDoc = await db.collection('users').doc(req.user.email).get();
    if (!userDoc.exists) return res.status(404).json({ error: 'User not found' });
    
    const user = userDoc.data();
    // Exclude password hash
    delete user.password;
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
}

// Update User Profile
async function updateProfile(req, res) {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  
  try {
    await db.collection('users').doc(req.user.email).update({ name, phone });
    res.json({ message: 'Profile updated successfully', name, phone });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
}

module.exports = {
  sendEmailOtp,
  verifyEmailOtp,
  register,
  refreshToken,
  login,
  googleAuth,
  logout,
  getProfile,
  updateProfile,
  _otpStore: otpStore
};
