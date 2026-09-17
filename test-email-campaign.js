const http = require('http');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function run() {
  console.log('1. Logging in as admin...');
  const loginRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/login',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    username: 'safdarali',
    password: 'safdarAli1'
  });

  console.log('Login status:', loginRes.status);
  const token = loginRes.body.token;
  if (!token) {
    console.error('Failed to get token:', loginRes.body);
    process.exit(1);
  }
  console.log('Obtained admin token successfully.');

  console.log('\n2. Fetching existing email campaigns log...');
  const getLogsRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/email-campaigns',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  console.log('Existing campaigns count:', getLogsRes.body.length);
  console.log('Existing campaigns:', JSON.stringify(getLogsRes.body, null, 2));

  console.log('\n3. Dispatching new test email marketing campaign to sahilkhiyatani25@gmail.com...');
  const sendRes = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/send-email',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  }, {
    targetType: 'Custom / Test Audience',
    recipientEmails: ['sahilkhiyatani25@gmail.com'],
    subject: 'Special Home Interior & AC Servicing Discount - Test Broadcast',
    body: 'Hello Sahil,\n\nThis is a live test of the Email Marketing Campaign system from Universal Interior & Microservices.\n\nEverything is working seamlessly!'
  });

  console.log('Send campaign status:', sendRes.status);
  console.log('Send campaign response:', JSON.stringify(sendRes.body, null, 2));

  console.log('\n4. Fetching updated email campaigns log...');
  const getLogsRes2 = await request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/admin/email-campaigns',
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  console.log('Updated campaigns count:', getLogsRes2.body.length);
  console.log('Updated campaigns log:', JSON.stringify(getLogsRes2.body, null, 2));
}

run().catch(console.error);
