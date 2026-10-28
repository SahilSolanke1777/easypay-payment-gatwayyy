# EasyPay — Self-Hosted Zero-Commission UPI Payment Gateway

A lightweight, zero-commission, self-hosted UPI payment gateway with dynamic QR code generation, mobile app deep links (Google Pay, PhonePe, Paytm, BHIM), and a modern Stitch-designed checkout interface.

## ✨ Features
- **0% Transaction Fees**: Payments go directly into your bank account via peer-to-peer (P2P) UPI rails.
- **Dynamic Scannable QR**: ISO-compliant vector SVG QR code generated on the fly.
- **1-Click Mobile App Launchers**: Instant intent buttons for Google Pay, PhonePe, Paytm, and generic UPI apps.
- **1-Paisa Collision Avoidance**: Automatically offsets concurrent identical orders (₹50.00, ₹50.01) for deterministic attribution.
- **Customizable Amount**: Supports in-place amount edits or URL query parameter (`?amount=10`).
- **UTR Fallback Verification**: Buyers can input their 12-digit UPI reference number to confirm payment.
- **Embedded SQLite WAL**: Zero database setup required; runs natively on Node.js 20+.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
node server.js
```
The gateway will be live at `http://localhost:3000`.

### 3. Expose to Mobile / Public Internet (Optional)
To test on your phone over mobile data / external network, run Cloudflare tunnel:
```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

## 🛠️ API Endpoints

- `POST /api/orders` — Create a new payment session (accepts `{ vpa, name, amount }`)
- `GET /api/orders/:id` — Poll order payment status
- `POST /api/orders/:id/verify` — Confirm/verify payment via 12-digit UTR
