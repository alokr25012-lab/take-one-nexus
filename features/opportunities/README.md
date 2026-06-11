# Film Opportunity Board Feature

The Film Opportunity Board is a centralized hub built on top of TAKE ONE Nexus where filmmakers can post project requirements/openings, and crew/talent can apply directly.

## Directory Structure & New Files
This feature is fully integrated into the existing architecture, with new files organized as follows:
- **Feature Documentation**: [features/opportunities/README.md](file:///v:/Nexus-spring-of-code/take-one-nexus/features/opportunities/README.md) (This file)
- **Database Schema**: Modified [prisma/schema.prisma](file:///v:/Nexus-spring-of-code/take-one-nexus/prisma/schema.prisma) with `Opportunity` and `OpportunityApplication` models.
- **Backend API Routes**: [routes/opportunities.js](file:///v:/Nexus-spring-of-code/take-one-nexus/routes/opportunities.js)
- **Frontend CSS Styling**: [public/styles/pages/opportunities.css](file:///v:/Nexus-spring-of-code/take-one-nexus/public/styles/pages/opportunities.css)
- **Frontend Interface Page**: [public/opportunities.htm](file:///v:/Nexus-spring-of-code/take-one-nexus/public/opportunities.htm)

---

## ⚡ Key Features
1. **Create Opportunity Posts**: Filmmakers can post project openings, detailing title, descriptions, and required roles.
2. **Specify Required Roles**: Required specialties (e.g., Director, Cinematographer, Art Director) can be specified as tags.
3. **Project Description**: Clear details for shoot dates, location, and requirements.
4. **Talent Applications**: Interested users can pitch themselves with a cover letter.
5. **Listing Page & Search Filters**: Filters by keywords and role types for easy navigation.
6. **Applicant Review Management**: Opportunity posters can accept/reject applications, triggering instant notifications to the applicants.

---

## 🛠️ Technology Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (dynamic DOM operations & Fetch API).
- **Backend**: Express.js, routing, and middlewares (auth, verification, CSRF check).
- **Database**: MySQL queried via Prisma ORM Client.

---

## 📡 API Reference

### 1. `POST /api/opportunities`
- **Auth**: Required & Email Verified.
- **Body**:
  ```json
  {
    "title": "DP Needed for Sci-Fi Short",
    "description": "Shooting in late July. Indigo color scheme. Need own gear.",
    "roles_needed": "Cinematographer, Gaffer"
  }
  ```

### 2. `GET /api/opportunities`
- **Query Params** (Optional): `search` (keyword), `role` (role badge filtering).
- **Response**: List of all opportunities with poster details and application counts.

### 3. `POST /api/opportunities/:id/apply`
- **Auth**: Required & Email Verified.
- **Body**:
  ```json
  {
    "message": "Hey! I've shot 3 short films on RED cameras. Here's my pitch..."
  }
  ```

### 4. `PATCH /api/opportunities/applications/:id/status`
- **Auth**: Required (Opportunity Owner Only).
- **Body**:
  ```json
  {
    "status": "accepted" // or "rejected"
  }
  ```

---

## 🏁 How to Run & Verify

1. Run Prisma generation:
   ```bash
   npx prisma generate
   ```
2. Migrate database schema (if database configuration is set):
   ```bash
   npx prisma db push
   ```
3. Start the application servers:
   ```bash
   npm run dev          # Start Next.js frontend proxy
   npm run legacy:dev   # Start Express backend server
   ```
4. Access the Opportunity Board locally at:
   `http://localhost:3000/opportunities`
