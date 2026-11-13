# AgriSetu: Firebase + GitHub Pages + ESP32 setup

This package keeps the existing AgriSetu GitHub Pages frontend and existing farmer, cold-storage, porter and buyer workflow pages. Firebase is added for authenticated portal sign-in and for live + historical ESP32 sensor storage.

## What is now connected

- The ESP32 authenticates as a dedicated Firebase Authentication device account.
- The currently published single-device rules authorize the tested Firebase Auth UID to write only to `COLD_BOX_01`. The `/deviceAccess/{uid}` mapping is retained as an administrative record for the future multi-device rule version.
- The ESP32 overwrites `/facilities/{facilityId}/latest` every 5 seconds.
- The ESP32 stores one historical sample every 60 seconds under `/facilities/{facilityId}/history/slot_{n}`. The slot number rotates across 10,080 minute slots, retaining a rolling seven days without unbounded history growth.
- Farmer and Cold Storage Monitoring pages subscribe to Firebase Realtime Database. They show live sensor readings and the last 60 historical samples.
- A Cold Storage user's access is limited to its `facilityId`.
- A Farmer can read only facilities explicitly allowed in `facilityIds`.
- Roles and facility grants are administrator-managed. A browser user cannot promote themselves or grant facility access.

## Important existing prototype limitation

The existing booking, inventory, marketplace, payment-demo and notification workflows still use browser `localStorage`. They have been left in place to preserve unrelated features. Therefore, those booking/batch records are not yet synchronized between separate farmer and cold-storage browsers. The Firebase sensor feed itself is shared across devices. A later separate migration is needed to move bookings, stock, marketplace and notifications into Firebase too.

The old localStorage-only login is no longer used for protected portal access. Users must create/sign in with Firebase Authentication and receive an administrator-approved `/userAccess/{uid}` record. This is intentional: a browser-stored password or role is not a secure identity.

---

## Part A — Create/configure Firebase

1. Open [Firebase Console](https://console.firebase.google.com/) and use the existing AgriSetu project `agrisetu-479fe`.
2. The `firebase-config.js` in this package is already populated with the Firebase Web App configuration visible in the project settings screenshot. If you create a different Firebase project, replace all values with that project's web configuration.
3. In **Authentication → Sign-in method**, enable **Email/Password**.
4. In **Authentication → Settings → Authorized domains**, add `aryavardhanjain-2006.github.io` (the host for the existing GitHub Pages website). Keep `localhost` only if you use it for local development.
5. In **Realtime Database**, create a database. Start in locked mode. Copy the exact database URL into `firebase-config.js` and `ESP32_Firebase/secrets.h`.
   - The URL may end with `firebaseio.com` or `firebasedatabase.app`; copy the exact URL shown in the console.
   - Choose the database location near the users/devices where possible. The database location cannot be changed after creation.
5. Deploy the security rules in `database.rules.json` using the Firebase Console Rules tab, or with the Firebase CLI steps below.

### Firebase web configuration

The included `firebase-config.js` is populated for `agrisetu-479fe` and the Realtime Database URL verified in the Firebase Console. The Firebase Web API key is a public client identifier, not an Admin SDK secret. Actual data access is controlled by Authentication and Realtime Database Rules. Never place a service-account JSON, database secret, Wi-Fi password, or ESP32 password in this repository.

### Deploy security rules with Firebase CLI (optional)

Install Firebase CLI on your computer:

```bash
npm install -g firebase-tools
firebase login
```

Copy `.firebaserc.example` to `.firebaserc`, replace `YOUR_FIREBASE_PROJECT_ID`, then run:

```bash
firebase use --add
firebase deploy --only database
```

Alternatively, paste the full contents of `database.rules.json` into **Realtime Database → Rules** and click **Publish**.

---

## Part B — Register and approve portal users

1. Open the deployed AgriSetu website.
2. Each farmer or cold-storage operator uses **Create one** to register with email/password and select the requested role. This creates a Firebase Authentication user, a profile and an `accessRequests/{uid}` record.
3. As project owner, open **Realtime Database → Data**. Find the new UID under `/accessRequests`. The admin Console view is privileged; normal app users cannot read other users' access requests.
4. In **Authentication → Users**, confirm the user's UID matches the key under `accessRequests`.
5. As project owner, manually add the approved record under `/userAccess/{uid}`. Example records are below.

### Cold-storage operator grant

For the operator of Agra Cold Storage:

```json
{
  "active": true,
  "role": "Cold Storage",
  "facilityId": "COLD_BOX_01",
  "storageName": "Agra Cold Storage"
}
```

### Farmer grant

Grant a farmer access only to facilities where that farmer has an accepted booking:

```json
{
  "active": true,
  "role": "Farmer",
  "facilityIds": {
    "COLD_BOX_01": true
  }
}
```

A farmer with accepted bookings at multiple facilities can have multiple facility IDs in that object. The user must not be allowed to write their own `/userAccess` record; the rules intentionally block that.

The sample IDs are configured in `firebase-config.js`:

- `COLD_BOX_01` — Agra Cold Storage
- `GREEN_FRESH_01` — Green Fresh Storage
- `YAMUNA_COLD_01` — Yamuna Cold Chain

Only `COLD_BOX_01` has a sample ESP32 configuration. Add another device account and map it to another facility before using the other IDs.

---

## Part C — Create a separate Firebase Auth identity for the ESP32

Do not use a farmer or cold-storage operator's login on the ESP32.

1. In **Authentication → Users → Add user**, create a dedicated device user, for example `esp32-coldbox01@your-own-domain.example`, and use a long random password.
2. Copy the device user's Firebase Auth UID. For the currently tested deployment, the UID is `AcyUBsOW9ePKOo87aUUxf0RYd9c2`.
3. In **Realtime Database → Data**, keep the admin-owned mapping under `/deviceAccess/{deviceUid}`:

```json
{
  "enabled": true,
  "facilityId": "COLD_BOX_01"
}
```

4. Do not add a `userAccess` record for the device. Device rules grant write access to the assigned facility only; they do not grant reads.
5. If the board is lost or the credentials leak, disable/delete that device user in Firebase Authentication and set `enabled` to `false` (or remove its `deviceAccess` record).

The ESP32 authenticates with Firebase Authentication's HTTPS password sign-in endpoint, receives a short-lived ID token and refresh token, and sends the ID token to the Realtime Database REST API. **Current rules in this package** explicitly authorize the tested UID `AcyUBsOW9ePKOo87aUUxf0RYd9c2` to write only to `COLD_BOX_01`; they do not dynamically read `/deviceAccess` for that write. The `/deviceAccess` node remains as a record for administration/future multi-device rules. Update both device `.write` rules before adding another ESP32 or changing facilities.

---

## Part D — Prepare and upload the ESP32 sketch

The folder `ESP32_Firebase/AgriSetu_ESP32_Firebase` contains:

- `AgriSetu_ESP32_Firebase.ino` — complete sketch
- `secrets.example.h` — template for private Wi-Fi and device credentials
- `firebase_ca_roots.h` — public TLS root certificates used to verify HTTPS server certificates

1. Open `ESP32_Firebase/AgriSetu_ESP32_Firebase` as the sketch folder in Arduino IDE.
2. Copy `secrets.example.h` to `secrets.h` in the same folder.
3. Fill `secrets.h` with Wi-Fi SSID/password, the Firebase Web API key, database URL, dedicated device email/password and `FACILITY_ID`.
4. `secrets.h` is excluded by `.gitignore`. Keep it on your computer only; do not commit it or share it publicly.
5. Install the **DHT sensor library** and **ArduinoJson** from Arduino Library Manager. `WiFi`, `WiFiClientSecure`, `HTTPClient` and `Preferences` are included with ESP32 Arduino core.
6. Select your ESP32 board/port and upload the sketch. Open Serial Monitor at **115200 baud**.

The original hardware pins and calculation are preserved: DHT22 on GPIO 4, MQ-5 analog output on GPIO 34, R1=1 kΩ, R2=2 kΩ, the original clean-air baseline and the original linear/quadratic gas estimate. The sketch now uploads latest data every 5 seconds and saves one historical sample per minute into a rolling seven-day (10,080-slot) history buffer. One ESP32 should be assigned to each facility ID; use a separate facility/device mapping if multiple independent sensor units are installed at one physical facility. Before connecting to Firebase, the sketch synchronizes time using NTP so TLS certificate validity can be checked correctly.

### TLS certificate maintenance

The firmware uses `setCACert()` with a small bundle of public Google Trust Services root certificates; it does **not** disable TLS verification. Google notes that its service certificate chains can change and recommends keeping the trusted CA set current. Refresh `firebase_ca_roots.h` from a maintained trusted CA bundle periodically, especially if TLS handshakes begin failing. Never replace certificate validation with `setInsecure()` for a deployed sensor.

---

## Part E — Publish the frontend on GitHub Pages

Commit these files to the repository root:

- `index.html`
- `app.js` (original app logic retained)
- `styles.css`
- `firebase-config.js` (with the public web config completed)
- `firebase-integration.js`
- `firebase-styles.css`
- `database.rules.json`
- `firebase.json`
- `FIREBASE_SETUP.md`
- existing `assets/` and `logo.png`

Do not commit `ESP32_Firebase/secrets.h`.

The project continues to load from the GitHub Pages URL. No Render, Vercel or always-on Node.js server is required for the sensor path.

---

## Part F — Expected database structure

```text
accessRequests/{authUid}
profiles/{authUid}
userAccess/{authUid}             # admin writes only
  active: true
  role: "Farmer" | "Cold Storage" | ...
  facilityId: "COLD_BOX_01"      # cold storage user
  facilityIds: { ... }           # farmer user

deviceAccess/{deviceAuthUid}     # admin writes only
  enabled: true
  facilityId: "COLD_BOX_01"

facilities/{facilityId}/latest
  facility_id
  temperature
  humidity
  methane_ppm
  raw_adc
  sensor_voltage
  device_timestamp_ms
  received_at                   # Firebase server timestamp (ms)

facilities/{facilityId}/history/{slot_0_to_10079}
  same fields as latest
```

## Troubleshooting

- **Firebase not configured:** check `firebase-config.js`; do not leave `REPLACE_...`/`YOUR_...` placeholders.
- **Login works but portal says approval pending:** add `/userAccess/{uid}` with `active: true`, a valid `role`, and the correct facility assignment.
- **ESP32 receives HTTP 403:** verify the device Firebase Auth UID is the key under `/deviceAccess`, `enabled` is `true`, the facility ID matches `FACILITY_ID`, and the published rules are current.
- **ESP32 receives HTTP 400:** inspect the JSON response in Serial Monitor; check numeric data, facility ID and timestamp fields.
- **ESP32 TLS connection fails:** verify the ESP32 can reach NTP servers (`pool.ntp.org`, `time.google.com` or `time.cloudflare.com`), update `firebase_ca_roots.h` from a maintained trusted CA bundle, and ensure the database URL uses HTTPS. The sketch waits for a valid NTP clock before making Firebase HTTPS requests.
- **Cold-storage panel says facility not linked:** set `userAccess/{coldStorageUid}/facilityId` to an ID defined in `firebase-config.js`.
- **Farmer sees no permitted facility:** add the facility ID to `userAccess/{farmerUid}/facilityIds` with value `true` after confirming an accepted booking.
- **Latest reading is stale:** check that the ESP32 is online and that `received_at` is updating. The UI marks data stale after 30 seconds.
- **History chart is empty:** allow up to one minute after boot for the first historical record; verify the history path exists and is readable by the current account.

## Safety and calibration note

The existing MQ-5 voltage-to-ppm calculation is retained as requested, but it is only an approximate prototype estimate. MQ-5 is a broad combustible-gas sensor, not a methane-specific calibrated instrument. Do not rely on this number for personnel safety or regulatory gas measurement without sensor characterization and calibration against known gas concentrations.

## Firebase quota note

Firebase Realtime Database Spark currently includes 1 GB stored data, 10 GB/month downloaded data and 100 simultaneous connections. The firmware keeps a maximum of 10,080 history records per facility (one sample per minute for seven days), overwriting the oldest weekly slots. Monitor usage in Firebase Console; the free-tier limits are shared across the Firebase project and may be exceeded as device count or dashboard traffic grows.
