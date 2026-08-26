const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('../firebase');
const { JWT_SECRET, hashPassword, generateAuthTokens } = require('../utils/authUtils');

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
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      memberSince: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    };
    
    await db.collection('users').doc(email.toLowerCase()).set(newUser);
    res.status(201).json({ message: 'User registered successfully' });
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
    const userDoc = await db.collection('users').doc(email.toLowerCase()).get();
    if (!userDoc.exists) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    
    const user = userDoc.data();
    if (user.password !== hashPassword(password)) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    
    const lastLoginAt = new Date().toISOString();
    await db.collection('users').doc(email.toLowerCase()).update({
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
  const { email, name, googleId } = req.body;
  
  if (!email || !name) {
    return res.status(400).json({ error: 'Google account details missing' });
  }
  
  try {
    const lowerEmail = email.toLowerCase();
    const userDoc = await db.collection('users').doc(lowerEmail).get();
    const lastLoginAt = new Date().toISOString();
    
    let user;
    if (!userDoc.exists) {
      user = {
        id: 'usr_' + crypto.randomBytes(6).toString('hex'),
        name,
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
  register,
  refreshToken,
  login,
  googleAuth,
  logout,
  getProfile,
  updateProfile
};
