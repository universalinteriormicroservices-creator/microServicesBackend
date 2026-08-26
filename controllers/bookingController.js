const crypto = require('crypto');
const { db } = require('../firebase');

// POST: Create a new booking
async function createBooking(req, res) {
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
}

// GET: Retrieve bookings
async function getBookings(req, res) {
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
}

// GET: Retrieve a single booking (with assigned employee info)
async function getBookingById(req, res) {
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
}

// PUT: Assign employee to a booking (Admin only)
async function assignEmployee(req, res) {
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
}

// PUT: Transition booking status lifecycle (Admin / Partner)
// Statuses: pending -> employee_assigned -> dispatched -> reached -> in_progress -> completed -> cancelled
async function updateBookingStatus(req, res) {
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
}

// PUT: Mark booking as completed + Submit rating & review (Customer)
async function completeBooking(req, res) {
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
}

module.exports = {
  createBooking,
  getBookings,
  getBookingById,
  assignEmployee,
  updateBookingStatus,
  completeBooking
};
