const test = require('node:test');
const assert = require('node:assert/strict');
const adminController = require('../controllers/adminController');
const { db } = require('../firebase');

test.describe('Email Marketing Campaign Suite', () => {
  test('sendEmailCampaign rejects request with missing subject or body', async () => {
    let statusCode = null;
    let responseData = null;
    const req = {
      body: {
        subject: '',
        body: 'Some content',
        targetType: 'custom',
        recipientEmails: ['sahilkhiyatani25@gmail.com']
      }
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { responseData = data; }
        };
      },
      json: (data) => { responseData = data; }
    };

    await adminController.sendEmailCampaign(req, res);
    assert.equal(statusCode, 400);
    assert.match(responseData.error, /Email Subject and Message Body are required/i);
  });

  test('sendEmailCampaign rejects request with no recipients', async () => {
    let statusCode = null;
    let responseData = null;
    const req = {
      body: {
        subject: 'Discount Promo',
        body: '20% off all services',
        targetType: 'custom',
        recipientEmails: []
      }
    };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (data) => { responseData = data; }
        };
      },
      json: (data) => { responseData = data; }
    };

    await adminController.sendEmailCampaign(req, res);
    assert.equal(statusCode, 400);
    assert.match(responseData.error, /No recipient email addresses provided or selected/i);
  });

  test('sendEmailCampaign successfully creates campaign record in store', async () => {
    let responseData = null;
    const req = {
      body: {
        subject: 'Automated Test Campaign',
        body: 'Test campaign body message',
        targetType: 'Direct Test Broadcast',
        recipientEmails: ['sahilkhiyatani25@gmail.com']
      }
    };
    const res = {
      status: (code) => ({ json: (d) => { responseData = d; } }),
      json: (data) => { responseData = data; }
    };

    await adminController.sendEmailCampaign(req, res);
    assert.ok(responseData);
    assert.ok(responseData.campaign);
    assert.match(responseData.campaign.id, /^CMP-/);
    assert.equal(responseData.campaign.recipientCount, 1);
    assert.deepEqual(responseData.campaign.recipients, ['sahilkhiyatani25@gmail.com']);
    assert.equal(responseData.campaign.status, 'Sent Successfully');

    // Verify it is retrievable via getEmailCampaigns
    let campaignsList = null;
    const getRes = {
      json: (data) => { campaignsList = data; }
    };
    await adminController.getEmailCampaigns({}, getRes);
    assert.ok(Array.isArray(campaignsList));
    const found = campaignsList.find(c => c.id === responseData.campaign.id);
    assert.ok(found, 'Created campaign must appear in getEmailCampaigns log');
    assert.equal(found.subject, 'Automated Test Campaign');
  });
});
