# Dynamic QR Studio

A professional, full-featured Dynamic QR Code Generator backend & admin dashboard built with Node.js and Express.

---

## 🌟 Key Features

### 1. Dynamic QR Codes & Redirection Engine
- **Instant Destination Updates**: Update destination URLs at any time via the admin dashboard without altering the printed or distributed QR code.
- **Fast 302 Redirection**: Short `/r/:slug` link redirects visitors seamlessly to the target destination.
- **Status & Lifespan Control**: Instantly activate, pause, or set campaign expiration dates for any QR code with branded error/maintenance fallback pages.
- **Custom Slugs**: Support for custom human-readable slugs (e.g. `/r/summer26`) or automated alphanumeric code generation.

### 2. QR Code Styling & High-Resolution Export
- **Formats**: Generates crisp, print-ready PNG (up to 1024px+) and infinite-resolution Vector SVG.
- **Color Customization**: Full hex color picker support for both foreground and background colors.
- **Error Correction Levels**: Configurable error correction levels (L: 7%, M: 15%, Q: 25%, H: 30%) for optimal scanning reliability even with logos or physical wear.
- **Direct Downloads**: Direct API endpoints for downloading PNG and SVG files with clean filenames.

### 3. Bulk Creation & Export Tools
- **CSV Spreadsheet Upload**: Drag-and-drop CSV importer with downloadable CSV template.
- **Multi-Line Quick Entry**: Batch create QR codes by simply pasting multiple URLs or `Title | URL | Slug` lines.
- **Bulk ZIP Download**: Download an entire batch or all QR codes as a ZIP package containing PNGs, SVGs, and a `manifest.csv`.
- **CSV Data Export**: Export entire database records and scan counters to CSV.

### 4. Redirection Analytics & Device Intelligence
- **Scan Metrics**: Total scans, today's scans, and unique visitors (deduplicated device hashes).
- **Device & Platform Fingerprinting**: Device type (Mobile vs Desktop vs Tablet), Operating System (iOS, Android, Windows, macOS, Linux), and Browser breakdown.
- **Referral Tracking**: Identifies referring traffic sources (Direct, Instagram, Google, Twitter, etc.).
- **Live Audit Trail**: Real-time scan event log with timestamps and device metadata.
- **Visual Analytics**: Interactive timeline line charts, device doughnut charts, and OS/Browser bar charts using Chart.js.

### 5. Admin Dashboard (SPA)
- Modern dark-themed user interface styled with Tailwind CSS and Lucide icons.
- Single-page application with tabs for **Overview**, **QR Codes**, **Create QR (with real-time live preview)**, **Bulk Tools**, **Analytics Deep Dive**, and **Settings**.
- Completely self-hosted; served directly from the backend server.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```

For development with hot-reload:
```bash
npm run dev
```

### 3. Access the Dashboard
Open your browser and navigate to:
```
http://localhost:3000
```

---

## 🔌 API Reference

### Overview & Metrics
- `GET /api/stats` - Fetch aggregated stats, 14-day timeline, device/OS/browser distributions, and top QR codes.

### QR Codes CRUD
- `GET /api/qr` - List QR codes with search, filter (`active=true|false`), and pagination.
- `POST /api/qr` - Create a new dynamic QR code.
- `GET /api/qr/:id` - Fetch single QR code details.
- `PUT /api/qr/:id` - Update destination URL, title, tags, active status, or colors.
- `DELETE /api/qr/:id` - Delete QR code and all its scan logs.

### Media & Preview
- `GET /api/qr/:id/preview?format=png|svg&size=300` - Stream QR code image for in-browser rendering.
- `GET /api/qr/:id/download?format=png|svg&size=1024` - Download QR code with attachment header.
- `GET /api/preview-custom?text=...&fgColor=...&bgColor=...` - Live preview generator endpoint.

### Bulk Endpoints
- `POST /api/bulk/create` - Bulk create via JSON array or multi-line text string.
- `POST /api/bulk/upload` - Bulk create by uploading a CSV file (`multipart/form-data`).
- `GET /api/bulk/export?format=all|png|svg` - Stream ZIP archive containing QR images and manifest CSV.
- `GET /api/bulk/export-csv` - Download all QR code metadata as CSV.

### Redirection Engine
- `GET /r/:slug` - Redirection endpoint for scanning/visiting. Automatically records scan analytics and issues an HTTP 302 redirect.

---

## 💾 Data Persistence

All data is safely stored in the `data/` directory using atomic JSON file storage with thread-safe writes:
- `data/qrcodes.json`: QR code configurations and metadata.
- `data/scans.json`: Redirection scan events and device metadata.
- `data/settings.json`: System configuration (Base URL, admin protection).
