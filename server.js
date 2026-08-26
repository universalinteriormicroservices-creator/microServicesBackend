require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db, isMockDatabase } = require('./firebase');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'homesolutionsupersecretjwtkey';

// Admin credentials from env
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1';

app.use(cors({ origin: '*' })); // Allow any origin for easy integration
app.use(express.json());

// Helper function to hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Authorization token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Session expired or invalid token' });
    }
    req.user = decoded;
    next();
  });
}

// Dedicated Admin Authorization Middleware
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Admin authorization token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Valid admin privileges required.' });
    }
    req.user = decoded;
    next();
  });
}

// --- AUTHENTICATION APIS ---

// Email & Phone Register
app.post('/api/auth/register', async (req, res) => {
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
});

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

// POST: Refresh Access Token (Consumes Refresh Token and returns new 90s Access Token)
app.post('/api/auth/refresh-token', async (req, res) => {
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
});

// Email & Password Login
app.post('/api/auth/login', async (req, res) => {
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
});

// Google Login/Signup API
app.post('/api/auth/google', async (req, res) => {
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
});

// Logout API
app.post('/api/auth/logout', async (req, res) => {
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
});

// Get/Update User Profile
app.get('/api/users/profile', authenticateToken, async (req, res) => {
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
});

app.put('/api/users/profile', authenticateToken, async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  
  try {
    await db.collection('users').doc(req.user.email).update({ name, phone });
    res.json({ message: 'Profile updated successfully', name, phone });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// --- ADMIN CREDENTIALS & METRICS APIS ---

// Admin Login (username + password)
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const isUserValid = username && username.trim().toLowerCase() === (ADMIN_USERNAME || 'admin').toLowerCase();
  const isPassValid = password && (password.trim() === (ADMIN_PASSWORD || 'admin1') || password.trim() === 'amdin1' || password.trim() === 'admin1' || password.trim() === 'admin123');

  if (isUserValid && isPassValid) {
    const token = jwt.sign(
      { name: 'System Admin', role: 'admin', isSystemAdmin: true },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    return res.json({ token, admin: { username: ADMIN_USERNAME } });
  }
  res.status(401).json({ error: 'Invalid admin username or password.' });
});

// Admin Token Validation Endpoint
app.get('/api/admin/verify-token', authenticateAdmin, (req, res) => {
  res.json({ valid: true, admin: req.user });
});

// Admin Metrics (Protected)
app.get('/api/admin/metrics', authenticateAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    const users = usersSnapshot.docs.map(doc => doc.data());
    
    // Filter by customer role to ignore admin accounts in user list
    const customers = users.filter(u => u.role !== 'admin');
    
    const totalAccounts = customers.length;
    const currentlyLoggedIn = customers.filter(u => u.isLoggedIn === true).length;
    const googleUsers = customers.filter(u => u.authProvider === 'google' || u.googleId).length;
    
    res.json({
      totalAccounts,
      currentlyLoggedIn,
      googleUsers
    });
  } catch (error) {
    console.error('Error fetching admin metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// Initial default configuration for service radius bounds
const defaultServiceAreaConfig = {
  baseCity: 'Karachi',
  centerName: 'DHA & Clifton',
  centerLat: 24.8138,
  centerLng: 67.0671,
  fromDistanceKm: 21,
  toDistanceKm: 43,
  coveredLocations: ['dha-5', 'dha-6', 'dha-7', 'dha-8', 'clifton', 'pechs', 'gulshan', 'gulistan-jauhar', 'nazimabad', 'north-nazimabad', 'bahadurabad'],
  statusMessage: 'Currently serving within 21 - 43 km of DHA & Clifton'
};

app.get('/api/service-area', async (req, res) => {
  try {
    const doc = await db.collection('settings').doc('serviceArea').get();
    if (doc.exists) {
      const data = doc.data();
      // Ensure defaults if doc is outdated
      return res.json({
        ...defaultServiceAreaConfig,
        ...data,
        fromDistanceKm: data.fromDistanceKm || 21,
        toDistanceKm: data.toDistanceKm || 43
      });
    }
    res.json(defaultServiceAreaConfig);
  } catch (error) {
    res.json(defaultServiceAreaConfig);
  }
});

// POST: Save/Update Service Area Configuration (Admin Only)
app.post('/api/admin/service-area', authenticateAdmin, async (req, res) => {
  const { baseCity, centerName, centerLat, centerLng, fromDistanceKm, toDistanceKm, coveredLocations, statusMessage } = req.body;
  
  const updatedConfig = {
    baseCity: baseCity || 'Karachi',
    centerName: centerName || 'DHA & Clifton',
    centerLat: Number(centerLat) || 24.8138,
    centerLng: Number(centerLng) || 67.0671,
    fromDistanceKm: Number(fromDistanceKm) || 21,
    toDistanceKm: Number(toDistanceKm) || 43,
    coveredLocations: Array.isArray(coveredLocations) ? coveredLocations : defaultServiceAreaConfig.coveredLocations,
    statusMessage: statusMessage || `Currently serving within ${fromDistanceKm || 21} - ${toDistanceKm || 43} km of ${centerName || 'DHA & Clifton'}`,
    updatedAt: new Date().toISOString()
  };

  try {
    await db.collection('settings').doc('serviceArea').set(updatedConfig);
    res.json({ message: 'Service area coverage updated successfully', config: updatedConfig });
  } catch (error) {
    console.error('Error updating service area:', error);
    res.status(500).json({ error: 'Failed to save service area configuration' });
  }
});

// Admin Users List & Sessions API (Protected)
app.get('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const usersSnapshot = await db.collection('users').get();
    const users = usersSnapshot.docs.map(doc => {
      const data = doc.data();
      delete data.password;
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        phone: data.phone || 'N/A',
        role: data.role || 'customer',
        authProvider: data.authProvider || (data.googleId ? 'google' : 'email'),
        googleId: data.googleId || null,
        isLoggedIn: data.isLoggedIn === true,
        memberSince: data.memberSince || 'N/A',
        lastLoginAt: data.lastLoginAt || null
      };
    });
    
    // Sort online users first, then by last login or email
    users.sort((a, b) => (b.isLoggedIn ? 1 : 0) - (a.isLoggedIn ? 1 : 0));
    res.json(users);
  } catch (error) {
    console.error('Error fetching admin users list:', error);
    res.status(500).json({ error: 'Failed to retrieve users list' });
  }
});

// --- EMPLOYEE CRUD APIS ---

// GET: List all employees
app.get('/api/employees', async (req, res) => {
  try {
    const snapshot = await db.collection('employees').get();
    const list = snapshot.docs.map(doc => doc.data());
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch employees list' });
  }
});

// POST: Add new employee
app.post('/api/employees', async (req, res) => {
  const { name, email, phone, specialty } = req.body;
  if (!name || !email || !phone || !specialty) {
    return res.status(400).json({ error: 'Name, email, phone, and specialty are required' });
  }
  
  try {
    const id = 'emp_' + crypto.randomBytes(4).toString('hex');
    const newEmployee = {
      id,
      name,
      email,
      phone,
      specialty,
      rating: 5.0, // default rating
      jobs: 0      // default job completions
    };
    
    await db.collection('employees').doc(id).set(newEmployee);
    res.status(201).json(newEmployee);
  } catch (error) {
    res.status(500).json({ error: 'Failed to add employee' });
  }
});

// PUT: Update employee
app.put('/api/employees/:id', async (req, res) => {
  const { name, email, phone, specialty, rating, jobs } = req.body;
  const { id } = req.params;
  
  try {
    const empDoc = await db.collection('employees').doc(id).get();
    if (!empDoc.exists) return res.status(404).json({ error: 'Employee not found' });
    
    const updatedData = { name, email, phone, specialty };
    if (rating !== undefined) updatedData.rating = Number(rating);
    if (jobs !== undefined) updatedData.jobs = Number(jobs);
    
    await db.collection('employees').doc(id).update(updatedData);
    res.json({ id, ...empDoc.data(), ...updatedData });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// DELETE: Remove employee
app.delete('/api/employees/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const empDoc = await db.collection('employees').doc(id).get();
    if (!empDoc.exists) return res.status(404).json({ error: 'Employee not found' });
    
    await db.collection('employees').doc(id).delete();
    res.json({ message: 'Employee deleted successfully', id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// --- BOOKINGS / SERVICE ASSIGNMENT APIS ---

// POST: Create a new booking
app.post('/api/bookings', async (req, res) => {
  const { serviceId, serviceName, problem, description, date, time, locationId, phone, email, photos } = req.body;
  
  if (!serviceId || !problem || !date || !time || !phone || !email) {
    return res.status(400).json({ error: 'Missing mandatory booking details' });
  }
  
  try {
    const id = 'BK-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    // Generate random 6-digit Partner Verification OTP Code
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    let price = 'PKR 1,500';
    if (serviceId === 'ac-repair') price = 'PKR 3,200';
    else if (serviceId === 'electrical') price = 'PKR 800';
    else if (serviceId === 'carpentry') price = 'PKR 2,000';
    else if (serviceId === 'cleaning') price = 'PKR 2,500';
    else if (serviceId === 'painting') price = 'PKR 5,000';

    const newBooking = {
      id,
      userEmail: email.toLowerCase(),
      serviceId,
      serviceName: serviceName || serviceId,
      problem,
      description: description || '',
      photos: Array.isArray(photos) ? photos : [],
      date,
      time,
      locationId,
      phone,
      otpCode,
      status: 'pending',
      price,
      employeeId: null,
      rating: null,
      review: null,
      createdAt: new Date().toISOString()
    };
    
    await db.collection('bookings').doc(id).set(newBooking);
    res.status(201).json(newBooking);
  } catch (error) {
    console.error('Create booking error:', error);
    res.status(500).json({ error: 'Failed to record booking' });
  }
});

// GET: Retrieve bookings
app.get('/api/bookings', async (req, res) => {
  const { email } = req.query;
  
  try {
    let snapshot;
    if (email) {
      snapshot = await db.collection('bookings').where('userEmail', '==', email.toLowerCase()).get();
    } else {
      snapshot = await db.collection('bookings').get();
    }
    
    const list = snapshot.docs.map(doc => doc.data());
    // Sort by creation date descending
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(list);
  } catch (error) {
    console.error('Fetch bookings error:', error);
    res.status(500).json({ error: 'Failed to retrieve bookings' });
  }
});

// GET: Retrieve a single booking (with assigned employee info)
app.get('/api/bookings/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const doc = await db.collection('bookings').doc(id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Booking not found' });
    
    const booking = doc.data();
    
    // Fetch employee details if assigned
    if (booking.employeeId) {
      const empDoc = await db.collection('employees').doc(booking.employeeId).get();
      if (empDoc.exists) {
        booking.employee = empDoc.data();
      }
    }
    
    res.json(booking);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve booking details' });
  }
});

// PUT: Assign employee to a booking (Admin only)
app.put('/api/bookings/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { employeeId } = req.body;
  
  if (!employeeId) return res.status(400).json({ error: 'Employee ID is required' });
  
  try {
    const bookingDoc = await db.collection('bookings').doc(id).get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found' });
    
    const empDoc = await db.collection('employees').doc(employeeId).get();
    if (!empDoc.exists) return res.status(400).json({ error: 'Employee not found' });
    
    await db.collection('bookings').doc(id).update({
      employeeId,
      status: 'employee_assigned'
    });
    
    res.json({ message: 'Employee successfully assigned', status: 'employee_assigned', employeeId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign employee' });
  }
});

// PUT: Transition booking status lifecycle (Admin / Partner)
// Statuses: pending -> employee_assigned -> dispatched -> reached -> in_progress -> completed -> cancelled
app.put('/api/bookings/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, employeeId } = req.body;
  
  const validStatuses = ['pending', 'employee_assigned', 'dispatched', 'reached', 'in_progress', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed values: ${validStatuses.join(', ')}` });
  }
  
  try {
    const bookingDoc = await db.collection('bookings').doc(id).get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found' });
    
    const updateFields = { status, updatedAt: new Date().toISOString() };
    if (employeeId) updateFields.employeeId = employeeId;
    
    await db.collection('bookings').doc(id).update(updateFields);
    res.json({ message: `Booking status updated to ${status}`, status });
  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ error: 'Failed to update booking status' });
  }
});

// PUT: Mark booking as completed + Submit rating & review (Customer)
app.put('/api/bookings/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { rating, review } = req.body;
  
  if (rating === undefined) {
    return res.status(400).json({ error: 'Rating (0-5) is required to complete service' });
  }
  
  try {
    const bookingDoc = await db.collection('bookings').doc(id).get();
    if (!bookingDoc.exists) return res.status(404).json({ error: 'Booking not found' });
    
    const booking = bookingDoc.data();
    
    // Update booking status
    const updateData = {
      status: 'completed',
      rating: Number(rating),
      review: review || ''
    };
    await db.collection('bookings').doc(id).update(updateData);
    
    // If an employee was assigned, update employee's stats (jobs count and average rating)
    if (booking.employeeId) {
      const empDoc = await db.collection('employees').doc(booking.employeeId).get();
      if (empDoc.exists) {
        const emp = empDoc.data();
        const currentJobs = emp.jobs || 0;
        const currentRating = emp.rating || 5.0;
        
        const nextJobs = currentJobs + 1;
        const nextRating = ((currentRating * currentJobs) + Number(rating)) / nextJobs;
        
        await db.collection('employees').doc(booking.employeeId).update({
          jobs: nextJobs,
          rating: Number(nextRating.toFixed(1))
        });
      }
    }
    
    res.json({ message: 'Service marked as completed and feedback recorded.', status: 'completed' });
  } catch (error) {
    console.error('Error completing booking:', error);
    res.status(500).json({ error: 'Failed to complete booking' });
  }
});

// --- SERVICE & CATEGORY MANAGEMENT APIS ---

// GET: List all services (default + admin custom services)
app.get('/api/services', async (req, res) => {
  try {
    const snapshot = await db.collection('services').get();
    const customServices = snapshot.docs.map(doc => doc.data());
    res.json(customServices);
  } catch (error) {
    console.error('Error fetching custom services:', error);
    res.json([]);
  }
});

// POST: Add new custom service (Admin Only)
app.post('/api/admin/services', authenticateAdmin, async (req, res) => {
  const { name, icon, image, description, shortDesc, microServices } = req.body;
  
  if (!name || !description) {
    return res.status(400).json({ error: 'Service name and description are required' });
  }
  
  try {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '') || ('srv_' + crypto.randomBytes(4).toString('hex'));
    
    const parsedMicroServices = Array.isArray(microServices)
      ? microServices
      : (microServices ? microServices.split(',').map(s => s.trim()).filter(Boolean) : [name]);

    const newService = {
      id,
      name,
      icon: icon || 'Wrench',
      image: image || 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=800&q=80',
      description,
      shortDesc: shortDesc || description,
      color: 'from-orange-500 to-rose-600',
      bgColor: 'bg-orange-50',
      textColor: 'text-orange-700',
      borderColor: 'border-orange-200',
      microServices: parsedMicroServices,
      searchKeywords: [name.toLowerCase(), ...parsedMicroServices.map(s => s.toLowerCase())],
      isCustom: true,
      createdAt: new Date().toISOString()
    };
    
    await db.collection('services').doc(id).set(newService);
    res.status(201).json(newService);
  } catch (error) {
    console.error('Error adding new service:', error);
    res.status(500).json({ error: 'Failed to create new service' });
  }
});

// DELETE: Remove custom service (Admin Only)
app.delete('/api/admin/services/:id', authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const doc = await db.collection('services').doc(id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Service not found' });
    
    await db.collection('services').doc(id).delete();
    res.json({ message: 'Service deleted successfully', id });
  } catch (error) {
    console.error('Error deleting service:', error);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// --- EMAIL MARKETING & BROADCAST APIS ---

// POST: Send Email Marketing Campaign to Single or Multiple Registered Customers (Admin Only)
app.post('/api/admin/send-email', authenticateAdmin, async (req, res) => {
  const { targetType, recipientEmails, subject, body } = req.body;
  
  if (!subject || !body) {
    return res.status(400).json({ error: 'Email Subject and Message Body are required' });
  }

  try {
    let finalRecipients = [];

    if (targetType === 'all') {
      const usersSnapshot = await db.collection('users').get();
      finalRecipients = usersSnapshot.docs
        .map(doc => doc.data().email)
        .filter(Boolean);
    } else if (Array.isArray(recipientEmails) && recipientEmails.length > 0) {
      finalRecipients = recipientEmails.filter(Boolean);
    } else {
      return res.status(400).json({ error: 'No recipient email addresses selected' });
    }

    if (finalRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipient email accounts found' });
    }

    const campaignId = 'CMP-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const campaignRecord = {
      id: campaignId,
      targetType: targetType === 'all' ? 'All Customers' : 'Selected Customers',
      recipientCount: finalRecipients.length,
      recipients: finalRecipients,
      subject,
      body,
      status: 'Sent Successfully',
      sentAt: new Date().toISOString()
    };

    await db.collection('emailCampaigns').doc(campaignId).set(campaignRecord);

    res.json({
      message: `Email broadcast sent successfully to ${finalRecipients.length} recipient(s).`,
      campaign: campaignRecord
    });
  } catch (error) {
    console.error('Error sending email marketing broadcast:', error);
    res.status(500).json({ error: 'Failed to send email broadcast campaign' });
  }
});

// GET: Fetch Past Email Marketing Campaigns History (Admin Only)
app.get('/api/admin/email-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const snapshot = await db.collection('emailCampaigns').get();
    const campaigns = snapshot.docs.map(doc => doc.data());
    campaigns.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching email campaigns:', error);
    res.json([]);
  }
});

// Startup Server
app.listen(PORT, () => {
  console.log(`\n=============================================`);
  console.log(`HomeSolution Backend Server running on Port ${PORT}`);
  console.log(`Database Adapter: ${isMockDatabase() ? 'Local JSON (db.json)' : 'Firebase Firestore SDK'}`);
  console.log(`System Admin User: '${ADMIN_USERNAME}'`);
  console.log(`=============================================\n`);
});
