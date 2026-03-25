const clients = new Map();

function getClient(clientId) {
  if (!clientId) return null;
  return clients.get(String(clientId)) || null;
}

function sendEvent(target, payload) {
  const client = typeof target === 'string' ? getClient(target) : target;
  if (!client) return false;
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

function attachProgressRoute(app) {
  app.get('/api/progress', (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).send('Missing clientId');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    clients.set(String(clientId), res);

    req.on('close', () => {
      clients.delete(String(clientId));
    });
  });
}

module.exports = {
  attachProgressRoute,
  getClient,
  sendEvent
};
