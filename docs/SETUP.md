# 🛠️ TAKE ONE Nexus — Local Contributor Setup Guide

Welcome to the TAKE ONE Nexus contributor team! This document is designed to get you up and running locally, with a fully functional local authentication and database seeding flow.

---

## 📋 Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v18.x or v20.x recommended)
- **npm** (v9.x or later)
- **MySQL** / **MariaDB** or a **TiDB Cloud** cluster (local or hosted instance)

---

## 🚀 Step-by-Step Local Setup

### 1. Clone & Fork the Repository
```bash
git clone https://github.com/your-username/take-one-nexus.git
cd take-one-nexus
npm install
```

### 2. Configure Environment Variables
Copy the `.env.example` file to create your local configurations:
```bash
cp .env.example .env
```

Open `.env` in your editor and configure the following:
```ini
# Database Connection (Standard Local MySQL Credentials)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=take_one
DB_USER=root
DB_PASSWORD=your_password

# Authentication (Must be 32+ characters for local safety checks)
JWT_SECRET=local_development_jwt_secret_must_be_32_chars_long

# Port & Environment (Vital for development middleware)
NODE_ENV=development
PORT=5001  # Express API backend
```

*Note: Ensure the local database `take_one` is created inside your MySQL console:*
```sql
CREATE DATABASE take_one;
```

---

## 🗄️ 3. Database Initialization & Seeding

We provide robust, automated npm scripts to initialize the database schema and populate it with realistic mock data (users, creative film crew, and sample scripts):

```bash
# Step A: Generate Prisma Clients & Push database schema
npx prisma generate
npx prisma db push

# Step B (Alternative): Direct raw SQL table setup
npm run db:init

# Step C: Populate database with test crew and creative profiles
npm run db:seed
```

### 🔑 Standard Mock Test Accounts

The seeder populates standard accounts configured with the password **`password123`**:

| Account Name | Email | Primary Role | Secondary Role (Admin) | Purpose |
|:---|:---|:---|:---|:---|
| **Aarush Gupta** | `aarushgupta289@gmail.com` | `Developer` | `admin` | Lead Maintainer and Developer profile with full admin dashboard access |
| **Test Admin** | `admin@takeone.test` | `Admin` | `admin` | General administrator profile for testing user moderation |
| **Arjun Mehta** | `arjun@takeone.test` | `Director` | *None* | Film Director account with sample posted horror scripts |
| **Kavya Rao** | `kavya@takeone.test` | `Cinematographer` | *None* | DP account with profile details, location, and film school details |
| **Rehan Ali** | `rehan@takeone.test` | `Writer` | *None* | Screenwriter account with romance genre script uploads |

---

## 🏎️ 4. Running the Development Servers

Due to the hybrid architecture, the platform requires two parallel processes: the Next.js frontend dev server (which handles routing and legacy API proxying) and the Express API backend.

### Terminal 1: Start Next.js Frontend App
```bash
npm run dev
```
*App will launch at [http://localhost:3000](http://localhost:3000)*

### Terminal 2: Start Express API Backend Server
```bash
npm run legacy:dev
```
*API will run at [http://localhost:5001](http://localhost:5001)*

---

## 🔍 5. Troubleshooting Local Auth Loops

If you experience "unauthenticated" redirect loops or cannot sign in on `localhost`, follow this check-list:

1. **Verify your Port Configurations**:
   - The Next.js dev server must be run on port `3000` (or `3001`/`3002`). The CORS configuration in `server.js` restricts origin domain headers in development specifically to these ports to protect development APIs from external scripts.
2. **Inspect Cookie Blocking in Browser**:
   - In your browser's Developer Tools (Application -> Cookies), verify that the `token` cookie is present.
   - If the cookie is missing, ensure you are testing on `http://localhost:3000` or `http://127.0.0.1:3000` and not using an external tunneling tool without updating `ALLOWED_ORIGINS`.
3. **Verify the Safe Console Logs**:
   - Look at the console where `npm run legacy:dev` is running.
   - Look for logs prefixed with `[AUTH_DEBUG]` and `[CSRF_DEBUG]` to trace if validation fails due to key mismatch, DB errors, or invalid/missing tokens.
4. **Clean Reset the Database**:
   - If you ever run into schema or query conflicts, reset your database state:
     ```bash
     npm run db:init
     npm run db:seed
     ```

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

