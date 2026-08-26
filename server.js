require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { isMockDatabase } = require('./firebase');
const { ADMIN_USERNAME } = require('./controllers/adminController');

// Import Modular Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const serviceRoutes = require('./routes/serviceRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON Parsing Middleware
app.use(cors({ origin: '*' }));
app.use(express.json());

// Root health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'HomeSolution Backend API is running live on Vercel!',
    status: 'online',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      admin: '/api/admin',
      employees: '/api/employees',
      bookings: '/api/bookings',
      services: '/api/services',
      serviceArea: '/api/service-area'
    }
  });
});

// Mount API Route Modules
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api', serviceRoutes);

// Startup Server
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n=============================================`);
    console.log(`HomeSolution Backend Server running on Port ${PORT}`);
    console.log(`Database Adapter: ${isMockDatabase() ? 'Local JSON (db.json)' : 'Firebase Firestore SDK'}`);
    console.log(`System Admin User: '${ADMIN_USERNAME}'`);
    console.log(`=============================================\n`);
  });
}

module.exports = app;

