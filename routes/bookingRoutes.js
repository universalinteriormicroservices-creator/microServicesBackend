const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

router.post('/', bookingController.createBooking);
router.get('/', bookingController.getBookings);
router.get('/:id', bookingController.getBookingById);
router.put('/:id/assign', bookingController.assignEmployee);
router.put('/:id/status', bookingController.updateBookingStatus);
router.put('/:id/complete', bookingController.completeBooking);

module.exports = router;
