const fs = require('node:fs');
const path = require('node:path');

function cleanEnv(name) {
  const raw = process.env[name];
  if (!raw) return '';
  return String(raw).trim().replace(/^['"]+|['"]+$/g, '');
}

function loadSpeechConfig() {
  const isAzure = Boolean(process.env.WEBSITE_SITE_NAME);
  const root = path.resolve(__dirname, '..', '..');
  let fileCfg = {};
  if (!isAzure) {
    try {
      const localPath = path.join(root, 'dataverse.local.json');
      if (fs.existsSync(localPath)) {
        fileCfg = JSON.parse(fs.readFileSync(localPath, 'utf8'));
      }
    } catch {
      // ignore malformed local files
    }
  }

  return {
    key: cleanEnv('SPEECH_KEY') || fileCfg.speech_key || '',
    region: cleanEnv('SPEECH_REGION') || fileCfg.speech_region || '',
    // Custom Speech deployment id (endpoint id) from Speech Studio
    customEndpointId: cleanEnv('SPEECH_CUSTOM_ENDPOINT_ID') || fileCfg.speech_custom_endpoint_id || '',
    maxSeconds: Number(cleanEnv('SPEECH_MAX_SECONDS') || fileCfg.speech_max_seconds || 30),
  };
}

async function issueSpeechToken() {
  const cfg = loadSpeechConfig();
  if (!cfg.key || !cfg.region) {
    const error = new Error(
      'Azure Speech is not configured. Set SPEECH_KEY and SPEECH_REGION on the Static Web App (or speech_key / speech_region in dataverse.local.json).',
    );
    error.status = 503;
    throw error;
  }

  const response = await fetch(`https://${cfg.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.key,
      'Content-Length': '0',
    },
  });
  const token = await response.text();
  if (!response.ok) {
    const error = new Error(token || `Unable to issue Azure Speech token (${response.status}).`);
    error.status = response.status;
    throw error;
  }

  return {
    token,
    region: cfg.region,
    customEndpointId: cfg.customEndpointId || undefined,
    maxSeconds: Number.isFinite(cfg.maxSeconds) && cfg.maxSeconds > 0 ? Math.min(cfg.maxSeconds, 30) : 30,
  };
}

module.exports = { loadSpeechConfig, issueSpeechToken };
