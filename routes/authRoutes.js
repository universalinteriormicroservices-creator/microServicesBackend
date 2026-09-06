const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/send-sms-otp', authController.sendSmsOtp);
router.post('/verify-sms-otp', authController.verifySmsOtp);
router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/google', authController.googleAuth);
router.post('/refresh-token', authController.refreshToken);
router.post('/logout', authController.logout);

module.exports = router;
