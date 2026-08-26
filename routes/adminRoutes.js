const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateAdmin } = require('../middlewares/authMiddleware');

router.post('/login', adminController.adminLogin);
router.get('/verify-token', authenticateAdmin, adminController.verifyToken);
router.get('/metrics', authenticateAdmin, adminController.getMetrics);
router.post('/service-area', authenticateAdmin, adminController.updateServiceArea);
router.get('/users', authenticateAdmin, adminController.getUsers);
router.post('/services', authenticateAdmin, adminController.addService);
router.delete('/services/:id', authenticateAdmin, adminController.deleteService);
router.post('/send-email', authenticateAdmin, adminController.sendEmailCampaign);
router.get('/email-campaigns', authenticateAdmin, adminController.getEmailCampaigns);

module.exports = router;
