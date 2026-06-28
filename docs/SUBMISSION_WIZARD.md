# 📝 Screenplay Submission Wizard

To elevate the quality of pitches on Take One Nexus, we replaced standard text fields in our creative submission forms with a highly interactive, cinematic submission helper tool.

---

## 🏗️ Architectural Overview

*   **File Locations**:
    *   Script: [submission-helper.js](file:///Users/aarushgupta/Documents/Projects/take-one-nexus/public/scripts/components/submission-helper.js)
    *   Styles: [project.css](file:///Users/aarushgupta/Documents/Projects/take-one-nexus/public/styles/pages/project.css) (Bottom sections)
*   **Initialization**:
    The system hooks directly into the dynamic form renderer (`renderDynamicUploadForm`) inside [project.js](file:///Users/aarushgupta/Documents/Projects/take-one-nexus/public/scripts/pages/project.js). When a Director or Writer logs in and opens the Upload vision area, the helper automatically initialises the widgets and wraps standard inputs.

## Payment Verification Lifecycle

- The wizard submits metadata to `/api/payments/create-order`, which stores only a temporary `script_drafts` row.
- Razorpay Checkout returns payment identifiers to the browser, but the browser result is not trusted.
- `/api/payments/verify` validates the HMAC signature on the backend. Only then is the script promoted into `scripts`.
- Failed payments show `PAYMENT FAILED — SCRIPT NOT SUBMITTED`; dismissed checkouts show `UPLOAD CANCELLED`; verified uploads show `TRANSMISSION ACCEPTED`.

---

## 🎨 1. Interactive Logline Builder

A film's logline is its calling card. The Logline Builder widget guides student screenwriters through structuring their film pitches clearly, merging four atomic story components into a single cinematic pitch.

```text
┌─────────────────────────────────────────────────────────────────┐
│  Logline Elements:                                              │
│  [ Protagonist ]   → e.g., "A rogue student sound recordist"     │
│  [ Incident ]      → e.g., "who overhears a secret faculty reel" │
│  [ Goal ]          │   → e.g., "must decode the mystery audio"   │
│  [ Stakes ]        → e.g., "before the term ends."              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Combined Output (Live Cyberpunk Preview Box):                 │
│  "A rogue student sound recordist who overhears a secret       │
│  faculty reel must decode the mystery audio before the term     │
│  ends."                                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Dynamic Binding
As the user types into any of the four builder inputs, keyup and change events combine the values using standard grammatical rules, automatically updating both the visible preview block and syncing the string to the hidden `#workSynopsis` form textarea. This ensures that when the user submits, the API receives a perfectly structured logline!

---

## 🎥 2. Interactive Crew Planner Chips

Instead of forcing creators to type out their required crew roles in a text field, the Crew Planner provides a grid of tap-to-toggle cyberpunk tags.

### Supported Specialties

*   **Director** (🎬)
*   **Cinematographer / DP** (🎥)
*   **Assistant Director** (AD)
*   **Editor**
*   **Sound Designer**
*   **Gaffer (Lighting)**
*   **Art Director**
*   **Actor**
*   **Production Assistant**

### Interactive Sync
Clicking on a crew chip toggles the active selection, visually highlighting the chip and instantly updating a comma-separated list synced directly to the hidden `#workTeam` field in the form. When the creator clicks "Submit Work", the database receives a clean role index that powers our search matching.

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

---

<div align="center">
  <p><i>Take One Nexus Submission Wiki • Designed for the Cinematic Future</i></p>
</div>

