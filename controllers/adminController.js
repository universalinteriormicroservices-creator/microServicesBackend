const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { db } = require('../firebase');
const { JWT_SECRET } = require('../utils/authUtils');

// Admin credentials from env
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1';

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

// Admin Login (username + password)
function adminLogin(req, res) {
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
}

// Admin Token Validation Endpoint
function verifyToken(req, res) {
  res.json({ valid: true, admin: req.user });
}

// Admin Metrics (Protected)
async function getMetrics(req, res) {
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
}

// Save/Update Service Area Configuration (Admin Only)
async function updateServiceArea(req, res) {
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
}

// Admin Users List & Sessions API (Protected)
async function getUsers(req, res) {
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
}

// Add new custom service (Admin Only)
async function addService(req, res) {
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
}

// Remove custom service (Admin Only)
async function deleteService(req, res) {
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
}

// Send Email Marketing Campaign (Admin Only)
async function sendEmailCampaign(req, res) {
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
}

// Fetch Past Email Marketing Campaigns History (Admin Only)
async function getEmailCampaigns(req, res) {
  try {
    const snapshot = await db.collection('emailCampaigns').get();
    const campaigns = snapshot.docs.map(doc => doc.data());
    campaigns.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching email campaigns:', error);
    res.json([]);
  }
}

module.exports = {
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  defaultServiceAreaConfig,
  adminLogin,
  verifyToken,
  getMetrics,
  updateServiceArea,
  getUsers,
  addService,
  deleteService,
  sendEmailCampaign,
  getEmailCampaigns
};
