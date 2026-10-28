import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import QRCode from 'qrcode';

const PORT = 3000;
const db = new DatabaseSync(path.join(import.meta.dirname, 'gateway.db'));

// Setup minimal database schema
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_ref TEXT NOT NULL UNIQUE,
    vpa TEXT NOT NULL,
    payee_name TEXT NOT NULL,
    base_amount NUMERIC NOT NULL,
    final_amount NUMERIC NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting', -- waiting, success, expired
    utr TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_orders_waiting ON orders(status, final_amount);
`);

// Build NPCI compliant UPI URI (clean P2P transfer format to avoid security decline)
function buildUpiUri({ vpa, name, amount, orderRef, note, isMerchant = false }) {
  const params = new URLSearchParams();
  params.set('pa', vpa);
  params.set('pn', name);
  params.set('am', amount.toFixed(2));
  params.set('cu', 'INR');
  params.set('tn', note || `Order ${orderRef}`);

  // Only add mode=04 and tr= for verified business accounts.
  // Personal VPAs (@ybl, @okaxis) trigger NPCI security decline if mode=04 or tr= is present.
  if (isMerchant) {
    params.set('mode', '04');
    params.set('tr', orderRef);
  }

  return `upi://pay?${params.toString()}`;
}

// Generate intent links for specific UPI apps
function buildIntentLinks(upiUri) {
  const query = upiUri.replace('upi://pay?', '');
  return {
    generic: upiUri,
    gpay: `tez://upi/pay?${query}`,
    phonepe: `phonepe://pay?${query}`,
    paytm: `paytmmp://pay?${query}`
  };
}

// 1-Paisa collision avoidance algorithm
function createOrder(vpa, payeeName, baseAmount) {
  const safeAmount = (typeof baseAmount === 'number' && !isNaN(baseAmount) && baseAmount > 0) ? baseAmount : 10.00;
  const basePaise = Math.round(safeAmount * 100);
  
  // Find currently waiting orders with similar amounts
  const waitingOrders = db.prepare(`
    SELECT CAST(ROUND(final_amount * 100) AS INTEGER) as amount_paise 
    FROM orders 
    WHERE status = 'waiting' AND final_amount >= ? AND final_amount < ? + 1
  `).all(safeAmount, safeAmount);

  const occupied = new Set(waitingOrders.map(row => row.amount_paise));
  let offset = 0;
  while (occupied.has(basePaise + offset) && offset < 100) {
    offset++;
  }

  const finalPaise = basePaise + offset;
  const finalAmount = finalPaise / 100;
  const orderRef = 'ORD' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();

  db.prepare(`
    INSERT INTO orders (order_ref, vpa, payee_name, base_amount, final_amount, status)
    VALUES (?, ?, ?, ?, ?, 'waiting')
  `).run(orderRef, vpa, payeeName, safeAmount, finalAmount);

  const order = db.prepare('SELECT * FROM orders WHERE order_ref = ?').get(orderRef);
  return order;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Helper to send JSON
    const sendJson = (data, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    };

    // Helper to parse JSON body
    const parseBody = () => new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
      });
    });

    // API: Create Order
    if (req.method === 'POST' && url.pathname === '/api/orders') {
      const { vpa, name, amount } = await parseBody();
      const numAmount = parseFloat(amount);
      if (!vpa || isNaN(numAmount) || numAmount <= 0) {
        return sendJson({ error: 'Valid vpa and positive numeric amount are required' }, 400);
      }

      const order = createOrder(vpa, name || 'Sahil', numAmount);
      const upiUri = buildUpiUri({
        vpa: order.vpa,
        name: order.payee_name,
        amount: order.final_amount,
        orderRef: order.order_ref,
        note: `Order ${order.order_ref}`
      });

      const qrSvg = await QRCode.toString(upiUri, { type: 'svg', margin: 1, width: 280 });
      const intents = buildIntentLinks(upiUri);

      return sendJson({
        orderRef: order.order_ref,
        baseAmount: order.base_amount,
        finalAmount: order.final_amount,
        status: order.status,
        upiUri,
        qrSvg,
        intents
      });
    }

  // API: Get Order Status
  if (req.method === 'GET' && url.pathname.startsWith('/api/orders/')) {
    const orderRef = url.pathname.replace('/api/orders/', '');
    const order = db.prepare('SELECT * FROM orders WHERE order_ref = ?').get(orderRef);
    if (!order) return sendJson({ error: 'Order not found' }, 404);
    return sendJson(order);
  }

  // API: Verify / Simulate payment
  if (req.method === 'POST' && url.pathname.endsWith('/verify')) {
    const orderRef = url.pathname.split('/')[3];
    const { utr } = await parseBody();

    const order = db.prepare('SELECT * FROM orders WHERE order_ref = ?').get(orderRef);
    if (!order) return sendJson({ error: 'Order not found' }, 404);

    db.prepare(`UPDATE orders SET status = 'success', utr = ? WHERE order_ref = ?`)
      .run(utr || 'SIMULATED_' + Date.now(), orderRef);

    return sendJson({ success: true, message: 'Payment confirmed successfully!' });
  }

  // Frontend: Stitch Design
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = fs.readFileSync(path.join(import.meta.dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
} catch (err) {
  console.error('Server error:', err);
  try {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  } catch {}
}
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ UPI Gateway Prototype running at http://localhost:${PORT}`);
});
