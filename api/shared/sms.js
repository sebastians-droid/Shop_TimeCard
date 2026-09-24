const { SmsClient } = require('@azure/communication-sms');
const { loadConfig } = require('./dataverse');

let cachedClient = null;

function getSmsClient() {
  if (cachedClient) return cachedClient;
  const cfg = loadConfig();
  if (!cfg.acsConnectionString) return null;
  cachedClient = new SmsClient(cfg.acsConnectionString);
  return cachedClient;
}

function formatPhoneNumber(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.startsWith('+')) return raw.replace(/[^\d+]/g, '');
  return null;
}

async function sendSms(toPhone, message) {
  const client = getSmsClient();
  if (!client) return { sent: false, reason: 'SMS not configured' };

  const cfg = loadConfig();
  if (!cfg.acsPhoneNumber) return { sent: false, reason: 'SMS phone number not configured' };

  const to = formatPhoneNumber(toPhone);
  if (!to) return { sent: false, reason: `Invalid phone number: ${toPhone}` };

  try {
    const [result] = await client.send({
      from: cfg.acsPhoneNumber,
      to: [to],
      message,
    });
    return result.successful
      ? { sent: true }
      : { sent: false, reason: result.errorMessage || 'SMS send failed' };
  } catch (error) {
    return { sent: false, reason: error.message || 'SMS send error' };
  }
}

module.exports = { sendSms, formatPhoneNumber };
