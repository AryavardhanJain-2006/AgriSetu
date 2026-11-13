# AgriSetu Web App

A functional AgriSetu frontend with Firebase Authentication and Firebase Realtime Database live monitoring.

## Publish this version

Follow [`UPLOAD_TO_GITHUB.md`](UPLOAD_TO_GITHUB.md) to upload the contents of this folder to the root of the `AgriSetu` GitHub repository. The Firebase Web App configuration in `firebase-config.js` is already filled for project `agrisetu-479fe`.

Before portal users can open the monitoring pages, each user must register with Firebase Email/Password and an administrator must approve their role/facility by creating `/userAccess/{uid}` in Realtime Database. See the upload guide for the exact Cold Storage and Farmer records.

The ESP32 writes live readings to `/facilities/COLD_BOX_01/latest` and historical samples to `/facilities/COLD_BOX_01/history`. Both the Farmer and Cold Storage Monitoring pages subscribe to the same facility data, subject to Firebase Security Rules.

**Security note:** `ESP32_Firebase/secrets.h` is not included and is excluded by `.gitignore`. Never commit device passwords, Wi-Fi passwords, Firebase Admin service-account keys, or other private credentials. The Firebase Web API key in `firebase-config.js` is a public client configuration value; database access is controlled by Authentication and Security Rules.

## Included till this stage

- Agrisetu landing page and logo
- Farmer login
- Local login persistence
- Farmer dashboard
- Spoilage-risk alert
- Dashboard metrics
- Current stored products
- Storage booking timeline
- Recent activity
- Book Storage multi-step flow
- Cold-storage selection
- Travel/porter selection
- Pickup OTP
- Payment modal
- Payment success screen
- Invoices
- Download invoice demo
- Notifications
- Sidebar sections for My Storage, My Products, Marketplace, Monitoring, Spoilage Alerts, Discounts and Payments

This is a front-end demo. Passwords are stored in localStorage only for the prototype; for a real deployment, use a secure backend/authentication system and never store plaintext passwords in browser storage.


## Current workflow additions

- My Storage shows only products whose storage booking has been accepted.
- Accepted batches expose live prototype readings for PT100 temperature, industrial humidity, NDIR CO2 and camera observations.
- Spoilage predictions are restricted to accepted/stored batches and are tied to the batch ID.
- Discounted products are automatically published to the shared buyer marketplace.
- Buyer marketplace listings are shared across farmer accounts, while farmer listings remain scoped to the logged-in farmer.
- In this front-end prototype, successful checkout records the storage acceptance state locally; replace this transition with the real cold-storage backend acceptance response when the backend API is connected.


## Latest workflow updates

- Porters receive a permanent `PRT-...` ID at registration. The ID is retained in their account/profile and displayed in farmer and buyer porter selection.
- Farmer-to-cold-storage rides use two separate OTPs: OTP 1 is shared with the farmer and entered at farm pickup; after it verifies, the farmer receives an “Item dispatched” notification and the cold-storage account receives OTP 2 in its notification list. OTP 2 is entered at the cold storage to complete receipt.
- Incoming Stock shows rides in `IN_TRANSIT`; Stored Stock shows only rides after OTP 2 verification. The cold-storage available-capacity counter is reduced at receipt and increases again when stored produce is sold.
- Cold-storage Price Listing lets the operator update price per kg per month, total capacity and currently available capacity.
- Farmer storage selection supports sorting by estimated distance, price and available capacity. The porter step includes a pickup-date calendar. Farmer-to-storage transport is calculated using the estimated farmer-to-storage distance multiplied by the porter rate (prototype default: ₹20/km).
- Farmer marketplace listings distinguish fresh produce from produce received at a cold storage. Fresh availability subtracts storage-committed quantities; active listings are also accounted for to avoid listing the same quantity twice.
- Buyer marketplace displays active listings from all farmers. On simulated checkout, the listing quantity and the seller’s My Products inventory are reduced, the farmer receives quantity/remaining-stock notifications, and stored-stock capacity is released when a stored listing is sold.

## Important prototype limitations

The web app still uses browser `localStorage` as its shared data store. Cross-account visibility therefore works only for accounts using the same browser profile/origin; it is not synchronized across separate devices or browsers. OTP delivery is via in-app notification records, not SMS/email. Payment is simulated, the distance estimator only recognizes Agra, Mathura and Firozabad (otherwise it uses the configured fallback estimate), and the ₹/km tariff is a prototype default. Use a backend with authenticated server-side OTP validation, transactional inventory updates, live routing/geocoding, secure payment gateway integration and a central database before production deployment.

## Legacy local ESP32 integration (superseded)

The following `server.js` instructions describe the earlier local-network prototype only. They are not used by the Firebase-enabled GitHub Pages deployment. For the current cloud setup, follow `FIREBASE_SETUP.md`; do not point the published GitHub Pages frontend at the local `/api/telemetry` route.

The local Node server remains in the repository for development/reference and its original source has been preserved.

### Run the website and sensor API

1. Install Node.js on the computer that will run the website.
2. Open a terminal in this `Agrisetu_Webapp_Updated` folder.
3. Run `node server.js`.
4. Open `http://localhost:3000` in the browser. Do not use the VS Code Live Server URL for this integration; use the Node server URL.
5. Find the computer's IPv4 address using `ipconfig` on Windows.
6. In `Test1_updated.ino`, enter your Wi-Fi name/password and replace `192.168.1.100` in `serverUrl` with that computer IPv4 address.
7. Ensure the computer and ESP32 are connected to the same Wi-Fi network, and allow Node.js through Windows Firewall on private networks.
8. Upload the sketch to the ESP32 and open Serial Monitor at 115200 baud.
9. In the Agrisetu account, open Monitoring. The page polls `/api/telemetry/COLD_BOX_01` every 3 seconds and updates the temperature, humidity and methane cards/graphs.

### API endpoints

- `POST /api/telemetry` — receives JSON from the ESP32.
- `GET /api/telemetry/COLD_BOX_01` — returns the latest reading for the facility.

The server currently keeps only the latest reading in memory. Restarting the server clears it; historical database storage is a separate next step. The ESP32 `facility_id` must match the ID used by the website request (`COLD_BOX_01`).

**MQ-5 note:** The current sketch's voltage-to-ppm formula is an approximate demonstration, not a calibrated methane measurement. MQ-5 is a broad combustible-gas sensor; proper preheating, load-resistor characterization and calibration against known gas concentrations are required before reporting reliable methane ppm. Do not use this prototype as a safety gas alarm.

## Firebase + GitHub Pages + authenticated ESP32 sensor integration

For the current Firebase implementation (authenticated live latest readings plus a bounded rolling seven-day history), follow [`FIREBASE_SETUP.md`](FIREBASE_SETUP.md). It includes the web configuration, Realtime Database rules, user approval model, per-device Firebase Auth identity, ESP32 HTTPS sketch, TLS/NTP setup and deployment steps.

The former in-memory `server.js` sensor API is retained only as a local-development reference; the Firebase-enabled GitHub Pages frontend does not use it.


## Automatic monitoring access for accepted bookings

Bookings are mirrored to Firebase Realtime Database so a Cold Storage operator can receive requests from a different device or browser. When the assigned operator accepts a booking, Realtime Database rules permit a booking-backed grant to be created for that farmer and facility. The farmer's Monitoring page then lists that facility and reads its live sensor data. This workflow uses Firebase Authentication and Realtime Database only; it does not require Cloud Functions or the Blaze plan. See `FIREBASE_SETUP.md` and `NO_BLAZE_ACCEPTED_BOOKING_ACCESS.md` for setup.

The synchronized authorization record excludes OTPs and payment details. Other legacy inventory, marketplace, payment-demo and notification workflows remain primarily browser-local.
