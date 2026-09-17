const nodemailer = require('nodemailer');

const BASE_EMAIL = 'universalinteriormicroservices@gmail.com';

/**
 * Configure Nodemailer Transport
 * Uses Gmail SMTP with credentials from environment variables if present,
 * or provides a simulated fallback logger for development and local testing.
 */
function createTransporter() {
  const user = process.env.EMAIL_USER || process.env.SMTP_USER || BASE_EMAIL;
  const pass = process.env.EMAIL_PASS || process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;

  if (pass) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user,
        pass
      }
    });
  }

  // If no password configured in .env, create transport or return null for safe simulation
  return null;
}

/**
 * Generate branded HTML email template for OTP code
 * @param {string} otp - 6-digit numeric OTP code
 * @returns {string} Branded HTML content
 */
function getOtpEmailHtml(otp) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Universal Interior - Verification Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 540px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, #ea580c 0%, #f97316 50%, #f59e0b 100%); padding: 36px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">
                Universal Interior
              </h1>
              <p style="margin: 6px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">
                & Microservices Karachi
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px 24px 32px; text-align: center;">
              <h2 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0f172a;">
                Your Account Verification Code
              </h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.6; color: #64748b;">
                Thank you for choosing Universal Interior & Microservices. Use the 6-digit verification code below to complete your registration or verify your account:
              </p>

              <!-- OTP Code Display Card -->
              <div style="background: #fff7ed; border: 2px dashed #f97316; border-radius: 14px; padding: 20px; margin: 0 auto 24px auto; max-width: 320px;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #c2410c; display: inline-block;">
                  ${otp}
                </span>
              </div>

              <!-- Expiry Alert -->
              <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 600; color: #ea580c;">
                ⏱ This verification code will expire in 5 minutes.
              </p>
              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                For your security, never share this code with anyone. Our support team will never ask for your verification code.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <div style="border-top: 1px solid #f1f5f9;"></div>
            </td>
          </tr>

          <!-- Footer Information -->
          <tr>
            <td style="padding: 24px 32px; background-color: #fafaf9; text-align: center; font-size: 11px; color: #78716c; line-height: 1.6;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #44403c;">
                Universal Interior & Microservices
              </p>
              <p style="margin: 0 0 4px 0;">
                Office No. A3, First Floor Econ Plaza, Near KFC, Nursery Shahra-e-Faisal, Karachi
              </p>
              <p style="margin: 0;">
                Direct inquiries: <a href="mailto:${BASE_EMAIL}" style="color: #ea580c; text-decoration: none; font-weight: 600;">${BASE_EMAIL}</a> | Helpline: +92 301 8665163
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Send OTP Verification Email
 * @param {string} toEmail - Recipient email address
 * @param {string} otp - 6-digit numeric OTP code
 * @returns {Promise<{success: boolean, simulated: boolean, message: string}>}
 */
async function sendEmailOtp(toEmail, otp) {
  const cleanEmail = (toEmail || '').trim().toLowerCase();
  if (!cleanEmail) {
    throw new Error('Recipient email address is required');
  }

  const transporter = createTransporter();
  const mailOptions = {
    from: `"Universal Interior & Microservices" <${BASE_EMAIL}>`,
    to: cleanEmail,
    subject: `Your Verification Code: ${otp} - Universal Interior & Microservices`,
    text: `Your Universal Interior verification code is ${otp}. Valid for 5 minutes. Do not share this code with anyone. Sent from ${BASE_EMAIL}`,
    html: getOtpEmailHtml(otp)
  };

  if (transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[EMAIL SERVICE] Real OTP dispatched via Gmail SMTP to ${cleanEmail} (Message ID: ${info.messageId})`);
      return {
        success: true,
        simulated: false,
        message: `Verification code sent to ${cleanEmail}`
      };
    } catch (err) {
      console.warn(`[EMAIL SERVICE] Gmail SMTP failed (${err.message}), falling back to simulated dispatch:`, err.message);
    }
  }

  // Simulated Dispatch (for local development or when EMAIL_PASS is not configured in .env)
  console.log('\n======================================================');
  console.log(`[EMAIL SERVICE - SIMULATED DISPATCH]`);
  console.log(`From: Universal Interior & Microservices <${BASE_EMAIL}>`);
  console.log(`To: ${cleanEmail}`);
  console.log(`Subject: Your Verification Code: ${otp}`);
  console.log(`Verification OTP: [ ${otp} ] (Valid for 5 minutes)`);
  console.log('======================================================\n');

  return {
    success: true,
    simulated: true,
    message: `Verification code sent to ${cleanEmail}`
  };
}

/**
 * Send General Marketing or Notification Email
 * @param {string} toEmail - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body (text or HTML)
 * @returns {Promise<{success: boolean, simulated: boolean, message: string}>}
 */
async function sendGeneralEmail(toEmail, subject, body) {
  const cleanEmail = (toEmail || '').trim().toLowerCase();
  const transporter = createTransporter();

  const mailOptions = {
    from: `"Universal Interior & Microservices" <${BASE_EMAIL}>`,
    to: cleanEmail,
    subject,
    text: body,
    html: `<div style="font-family: sans-serif; line-height: 1.6; color: #333; padding: 20px;">
      <h2 style="color: #ea580c;">Universal Interior & Microservices</h2>
      <div style="margin-top: 15px;">${body.replace(/\n/g, '<br/>')}</div>
      <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #888;">Universal Interior & Microservices Karachi · ${BASE_EMAIL}</p>
    </div>`
  };

  if (transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[EMAIL SERVICE] Real Campaign Email dispatched via Gmail SMTP to ${cleanEmail} (Message ID: ${info?.messageId})`);
      return { success: true, simulated: false, message: `Email sent to ${cleanEmail}` };
    } catch (err) {
      console.warn('[EMAIL SERVICE] General email dispatch failed, simulated fallback:', err.message);
    }
  }

  console.log(`[EMAIL SERVICE - SIMULATED CAMPAIGN] Sent to ${cleanEmail}: ${subject}`);
  return { success: true, simulated: true, message: `Email simulated to ${cleanEmail}` };
}

module.exports = {
  BASE_EMAIL,
  sendEmailOtp,
  sendGeneralEmail,
  getOtpEmailHtml
};
