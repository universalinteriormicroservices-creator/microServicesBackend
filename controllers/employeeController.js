const crypto = require('crypto');
const { db } = require('../firebase');

// GET: List all employees
async function getEmployees(req, res) {
  try {
    const snapshot = await db.collection('employees').get();
    const list = snapshot.docs.map(doc => doc.data());
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch employees list' });
  }
}

// POST: Add new employee
async function addEmployee(req, res) {
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
}

// PUT: Update employee
async function updateEmployee(req, res) {
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
}

// DELETE: Remove employee
async function deleteEmployee(req, res) {
  const { id } = req.params;
  try {
    const empDoc = await db.collection('employees').doc(id).get();
    if (!empDoc.exists) return res.status(404).json({ error: 'Employee not found' });
    
    await db.collection('employees').doc(id).delete();
    res.json({ message: 'Employee deleted successfully', id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete employee' });
  }
}

module.exports = {
  getEmployees,
  addEmployee,
  updateEmployee,
  deleteEmployee
};
