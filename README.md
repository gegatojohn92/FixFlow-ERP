# FixFlow ERP

FixFlow ERP is a multi-department operational, procurement, financial, and preventive maintenance web application designed for hospitality and facility environments such as hotels, resorts, and commercial complexes.

Operating natively in Philippine Peso (₱), FixFlow connects ground-level staff maintenance requests directly to accounting ledgers, inventory, asset upkeep schedules, and executive (Owner) approval workflows.

---

## 🚀 Core Features

- **Actual-Spent Bookkeeping Baseline**: Financial reports are computed strictly from verified vendor receipts rather than canvassed estimates:
  $$\text{Total MRS Spent} = \sum (\text{Actual Unit Price}_i \times \text{Fulfilled Qty}_i) + \text{Actual Shipping Fee}$$
- **Four-Step Chain-of-Custody Ledger**: Transparent fund movements between Accounting, Budget Officers, Purchasers, and Front Desk revolving floats with digital transmittals and dual-party signatures.
- **Frictionless Executive Approval**: 1-click snapshot export (PNG/PDF) of canvassed pricing for messaging channels (Messenger/WhatsApp), allowing offline Owner approval logging.
- **Preventive Maintenance Engine**: Recurring asset schedules with automatic Job Order (JO) generation and technician assignment.
- **Audit-Safe Soft Deactivation**: Role-based access control with historical signature integrity preserved via soft deactivation.
- **PWA Ready**: Mobile-first design supporting camera capture for receipts/site photos and barcode scanning for COD deliveries.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 14+](https://nextjs.org/) (App Router)
- **Backend / Database**: [Supabase](https://supabase.com/) (PostgreSQL, Row-Level Security, Auth, Storage)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Form Management**: React Hook Form + Zod
- **Mobile Capabilities**: Progressive Web App (PWA) with hardware camera & barcode integration

---

## 📋 System Documentation

Detailed specification, database DDL, role-based workflows, and implementation phases are documented in [Plan.md](Plan.md).

---

## 📄 License

Proprietary — All rights reserved.
