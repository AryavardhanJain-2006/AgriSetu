# AgriSetu: Firebase + GitHub Pages + ESP32 setup

This package keeps the existing AgriSetu GitHub Pages frontend and existing farmer, cold-storage, porter and buyer workflow pages. Firebase is added for authenticated portal sign-in and for live + historical ESP32 sensor storage.

## What is now connected

- The ESP32 authenticates as a dedicated Firebase Authentication device account.
- ESP32 write access is checked against the admin-managed `/deviceAccess/{uid}` record. A device can write only to its assigned `facilityId`.
- The ESP32 overwrites `/facilities/{facilityId}/latest` every 5 seconds and stores a rolling seven-day history under `/facilities/{facilityId}/history`.
- Farmer and Cold Storage Monitoring pages subscribe to Firebase Realtime Database and show live readings and recent history.
- A Cold Storage account can see only bookings for the `facilityId` assigned to that account and can accept/reject those bookings.
- When a booking is accepted, Realtime Database rules authorize a matching farmer/facility monitoring grant. Farmers can read only facilities for which that grant exists (plus any legacy administrator-granted facility IDs).
- Booking requests and status are synchronized across farmer and storage browsers. OTPs and payment details are not copied into the shared monitoring-authorization record.
- No Cloud Functions, Cloud Build API, or Blaze billing plan is required for this workflow.

## Important existing prototype limitation

The shared cloud record synchronizes booking metadata needed for cross-device request review and monitoring authorization. The rest of the legacy booking, transport, inventory, marketplace, payment-demo and notification workflow still uses browser `localStorage`; those features have not all been migrated to a shared cloud database. For the additional facilities in `firebase-config.js`, a working sensor feed also requires an ESP32 configured for that facility ID and a matching `/deviceAccess/{uid}` record.

The old localStorage-only login is no longer used for protected portal access. New users sign in with Firebase Authentication and automatically create their own one-time `/userAccess/{uid}` record under restrictive Realtime Database rules. Public registration cannot create an Admin account. Cold Storage registration additionally requires a facility-specific registration code; do not publish these codes in the website repository.

---

## Part A — Create/configure Firebase

1. Open [Firebase Console](https://console.firebase.google.com/) and use the existing AgriSetu project `agrisetu-479fe`.
2. The `firebase-config.js` in this package is already populated with the Firebase Web App configuration visible in the project settings screenshot. If you create a different Firebase project, replace all values with that project's web configuration.
3. In **Authentication → Sign-in method**, enable **Email/Password**.
4. In **Authentication → Settings → Authorized domains**, add `aryavardhanjain-2006.github.io` (the host for the existing GitHub Pages website). Keep `localhost` only if you use it for local development.
5. In **Realtime Database**, create a database. Start in locked mode. Copy the exact database URL into `firebase-config.js` and `ESP32_Firebase/secrets.h`.
   - The URL may end with `firebaseio.com` or `firebasedatabase.app`; copy the exact URL shown in the console.
   - Choose the database location near the users/devices where possible. The database location cannot be changed after creation.
6. Deploy the security rules in `database.rules.json` using the Firebase Console Rules tab, or with the Firebase CLI steps below. No Cloud Functions, Cloud Build API, or Blaze plan is required. This version uses Realtime Database rules and the existing Firebase Authentication accounts.

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


### Automatic monitoring access for accepted bookings (no Blaze plan)

The booking workflow is synchronized through Firebase Realtime Database so that a farmer and a cold-storage operator can use different devices or browsers. When a farmer creates a booking, the app writes a minimal booking record to `/storageBookings/{facilityId}/{bookingId}` with the authenticated Firebase UID. When the assigned cold-storage operator accepts it, the app updates that shared record and writes a grant under `/monitoringAccess/{farmerUid}/facilityIds/{facilityId}`. Realtime Database Security Rules verify that:

- the booking was created by the signed-in Farmer account;
- only the active Cold Storage account assigned to that exact `facilityId` can accept/reject it;
- the monitoring grant points to a booking owned by the farmer and already marked `ACCEPTED`;
- farmers cannot write their own monitoring grants or change their booking status.

No Cloud Functions are used. Deploy only the Realtime Database rules. The booking record synchronized for authorization contains only the booking reference, farmer UID/name/email, facility, product, batch, quantity, timestamps and status. Farmer/porter OTPs and payment details are not uploaded in this authorization record.

**Important:** New `/userAccess/{uid}` records are created automatically once by the authenticated user under the database rules. Existing access records are not overwritten by registration. Cold Storage accounts must use the matching facility-specific registration code. The current `firebase-config.js` maps `COLD_BOX_01` (Agra), `GREEN_FRESH_01` (Green Fresh) and `YAMUNA_COLD_01` (Yamuna). Add another entry there and a matching private registration code for every additional facility.

## Part B — Automatic portal registration

1. In Realtime Database, create `/facilityRegistrationCodes/COLD_BOX_01` with a long, random code (at least 12 characters). Create corresponding values for other facilities as needed. Keep this node unreadable to clients; the default root-deny rules already do this.
2. Give each facility's registration code only to its authorized Cold Storage operator. Do not put the codes in `firebase-config.js`, `app.js`, GitHub, or public documentation.
3. Deploy the updated `database.rules.json` and the updated `app.js` and `firebase-integration.js`.
4. Farmers, Buyers and Porters can register and are activated automatically. Cold Storage operators select their facility and enter its code; the app creates `/userAccess/{uid}` automatically.
5. The rules permit a new authenticated user to create only their own access record once, require the role to match their own profile's requested role, reject public Admin registration, and require a matching facility code for Cold Storage.
6. Legacy accounts created before this change that have a profile but no `/userAccess/{uid}` record can complete one-time activation at login. A legacy Cold Storage user must enter the facility code at first login.
7. Existing `/userAccess/{uid}` records are not overwritten. If an older Cold Storage record has only `facilityIds/COLD_BOX_01: true` and no singular `facilityId`, add `facilityId: "COLD_BOX_01"` once to that existing record.

### Cold-storage operator grant

Set the `facilityId` to the exact ID assigned to that storage in `firebase-config.js`:

| Cold storage | `facilityId` |
|---|---|
| Agra Cold Storage | `COLD_BOX_01` |
| Green Fresh Storage | `GREEN_FRESH_01` |
| Yamuna Cold Chain | `YAMUNA_COLD_01` |

For example, the Agra operator record is:

```json
{
  "active": true,
  "role": "Cold Storage",
  "facilityId": "COLD_BOX_01",
  "storageName": "Agra Cold Storage"
}
```

### Farmer grant

Farmers do not need a manual `facilityIds` grant for new bookings. When a Cold Storage operator accepts a booking, the app creates a separate booking-backed grant automatically under `/monitoringAccess/{farmerUid}/facilityIds/{facilityId}`. A farmer with accepted bookings at multiple facilities receives one grant for each facility. New users can create only their own initial `/userAccess` record once; they cannot edit or elevate it later, and the rules never permit public Admin registration.

The sample IDs are configured in `firebase-config.js`:

- `COLD_BOX_01` — Agra Cold Storage
- `GREEN_FRESH_01` — Green Fresh Storage
- `YAMUNA_COLD_01` — Yamuna Cold Chain

The sample ESP32 sketch is configured with `COLD_BOX_01` by default. For `GREEN_FRESH_01`, `YAMUNA_COLD_01`, or any added facility, create a separate device Firebase Auth account, add a matching `/deviceAccess/{deviceUid}` mapping and set that board's `FACILITY_ID` to the same facility ID.

---

## Part C — Create a separate Firebase Auth identity for the ESP32

Do not use a farmer or cold-storage operator's login on the ESP32.

1. In **Authentication → Users → Add user**, create a dedicated device user, for example `esp32-coldbox01@your-own-domain.example`, and use a long random password.
2. Copy the device user's Firebase Auth UID. The previously tested Agra device UID is `AcyUBsOW9ePKOo87aUUxf0RYd9c2`.
3. In **Realtime Database → Data**, add/verify the admin-owned mapping under `/deviceAccess/{deviceUid}`:

```json
{
  "enabled": true,
  "facilityId": "COLD_BOX_01"
}
```

4. Do not add a `userAccess` record for the device. Device rules grant write access to the assigned facility only; they do not grant reads.
5. If the board is lost or the credentials leak, disable/delete that device user in Firebase Authentication and set `enabled` to `false` (or remove its `deviceAccess` record).

The ESP32 authenticates with Firebase Authentication's HTTPS password sign-in endpoint, receives a short-lived ID token and refresh token, and sends the ID token to the Realtime Database REST API. The rules check the signed-in device UID against `/deviceAccess/{deviceUid}` and verify its assigned `facilityId` for both latest and history writes. This supports separate ESP32 devices for multiple configured facilities without changing the security-rule expressions for every device.

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
profiles/{authUid}
userAccess/{authUid}             # user creates own record once under strict rules
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
- **Automatic registration is denied:** confirm the updated `database.rules.json` is published, the profile exists at `/profiles/{uid}`, and the requested role matches the role selected at registration. For Cold Storage, verify the selected facility has a matching private `/facilityRegistrationCodes/{facilityId}` value and that the operator entered it correctly.
- **ESP32 receives HTTP 403:** verify the device Firebase Auth UID is the key under `/deviceAccess`, `enabled` is `true`, the facility ID matches `FACILITY_ID`, and the published rules are current.
- **ESP32 receives HTTP 400:** inspect the JSON response in Serial Monitor; check numeric data, facility ID and timestamp fields.
- **ESP32 TLS connection fails:** verify the ESP32 can reach NTP servers (`pool.ntp.org`, `time.google.com` or `time.cloudflare.com`), update `firebase_ca_roots.h` from a maintained trusted CA bundle, and ensure the database URL uses HTTPS. The sketch waits for a valid NTP clock before making Firebase HTTPS requests.
- **Cold-storage panel says facility not linked:** confirm the new account was registered with the correct facility code and that `userAccess/{coldStorageUid}/facilityId` matches an ID defined in `firebase-config.js`. For accounts created before automatic registration was deployed, add the singular `facilityId` field once in the existing record.
- **Farmer sees no permitted facility:** confirm the shared booking under `storageBookings/{facilityId}/{bookingId}` has status `ACCEPTED`, then check `monitoringAccess/{farmerUid}/facilityIds/{facilityId}`. The Cold Storage operator must have the same `facilityId` in its admin-managed `/userAccess` record.
- **Cold Storage sees no new requests:** confirm its `userAccess/{uid}/facilityId` matches the selected facility's ID in `firebase-config.js`, and confirm it is signed in with the same Firebase account used during registration.
- **A facility has no sensor readings:** confirm an ESP32 is configured for that facility ID and that its device UID has `{ enabled: true, facilityId: "..." }` under `/deviceAccess/{deviceUid}`. The sensor path must be `facilities/{facilityId}/latest` and `facilities/{facilityId}/history`.
- **Latest reading is stale:** check that the ESP32 is online and that `received_at` is updating. The UI marks data stale after 30 seconds.
- **History chart is empty:** allow up to one minute after boot for the first historical record; verify the history path exists and is readable by the current account.

## Safety and calibration note

The existing MQ-5 voltage-to-ppm calculation is retained as requested, but it is only an approximate prototype estimate. MQ-5 is a broad combustible-gas sensor, not a methane-specific calibrated instrument. Do not rely on this number for personnel safety or regulatory gas measurement without sensor characterization and calibration against known gas concentrations.

## Firebase quota note

Firebase Realtime Database Spark currently includes 1 GB stored data, 10 GB/month downloaded data and 100 simultaneous connections. The firmware keeps a maximum of 10,080 history records per facility (one sample per minute for seven days), overwriting the oldest weekly slots. Monitor usage in Firebase Console; the free-tier limits are shared across the Firebase project and may be exceeded as device count or dashboard traffic grows.
