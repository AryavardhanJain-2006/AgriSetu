# Agrisetu Web App

A functional front-end prototype for the Agrisetu farmer portal.

## Run in VS Code

1. Open the `Agrisetu_Webapp` folder in VS Code.
2. Make sure these files exist:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `assets/logo.png`
3. Open `index.html` in a browser, or use the VS Code Live Server extension.
4. Click **Login / Get Started**.
5. Choose **Farmer**, enter an email and password, and log in.
6. The app remembers the login in browser `localStorage`, so the returning user can sign in again with the saved account.

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

## ESP32 DHT22 + MQ-5 live sensor integration

The project now includes `server.js`, a small Node.js server that both serves the website and receives ESP32 sensor readings. It uses Node's built-in modules, so no npm packages are required.

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
