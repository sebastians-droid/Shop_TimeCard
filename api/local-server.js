const http = require('node:http');
const { handleRequest } = require('./shared/handlers');

const PORT = Number(process.env.API_PORT || 7071);

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-ms-client-principal');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(','));
    else if (value) headers.set(key, value);
  }

  const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
  });

  const result = await handleRequest(request);
  res.statusCode = result.status;
  for (const [key, value] of Object.entries(result.headers || {})) {
    res.setHeader(key, value);
  }
  if (result.status === 204) {
    res.end();
    return;
  }
  res.end(JSON.stringify(result.jsonBody ?? {}));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Shop Timecard API listening on http://127.0.0.1:${PORT}`);
});
