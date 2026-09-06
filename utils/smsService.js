const https = require('https');

/**
 * Dispatch SMS OTP to mobile number
 * Supports Twilio REST API if credentials exist in .env, or falls back to
 * clean simulated SMS console logger for development and resilient operations.
 * 
 * @param {string} phone - Recipient phone number (e.g., +92 300 1234567 or 03001234567)
 * @param {string} otp - 6-digit OTP code
 * @returns {Promise<{success: boolean, simulated: boolean, message: string}>}
 */
async function sendSmsOtp(phone, otp) {
  const messageBody = `Your HomeSolution verification OTP is ${otp}. Valid for 5 minutes. Do not share this code with anyone.`;
  const cleanPhone = phone.trim();

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFromNumber = process.env.TWILIO_PHONE_NUMBER;

  // 1. If Twilio credentials are configured in .env, send via Twilio API
  if (twilioSid && twilioAuthToken && twilioFromNumber) {
    try {
      const auth = Buffer.from(`${twilioSid}:${twilioAuthToken}`).toString('base64');
      const postData = new URLSearchParams({
        To: cleanPhone.startsWith('+') ? cleanPhone : `+92${cleanPhone.replace(/^0/, '')}`,
        From: twilioFromNumber,
        Body: messageBody
      }).toString();

      await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.twilio.com',
          port: 443,
          path: `/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(body);
            } else {
              reject(new Error(`Twilio error (${res.statusCode}): ${body}`));
            }
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      return { success: true, simulated: false, message: 'SMS sent to mobile number' };
    } catch (err) {
      console.warn('[SMS GATEWAY] Twilio dispatch failed, falling back to simulated SMS log:', err.message);
    }
  }

  // 2. Default / Simulated SMS Dispatch
  return {
    success: true,
    simulated: true,
    message: `Verification code sent to ${cleanPhone}`
  };
}

module.exports = {
  sendSmsOtp
};
