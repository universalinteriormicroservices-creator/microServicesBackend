const { db } = require('../firebase');
const { defaultServiceAreaConfig } = require('./adminController');

// GET: Retrieve service area configuration
async function getServiceArea(req, res) {
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
}

// GET: List all services (default + admin custom services)
async function getServices(req, res) {
  try {
    const snapshot = await db.collection('services').get();
    const customServices = snapshot.docs.map(doc => doc.data());
    res.json(customServices);
  } catch (error) {
    console.error('Error fetching custom services:', error);
    res.json([]);
  }
}

module.exports = {
  getServiceArea,
  getServices
};
