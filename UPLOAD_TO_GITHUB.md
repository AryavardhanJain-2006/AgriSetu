# AgriSetu — upload this website to GitHub Pages

This package contains the existing AgriSetu frontend with Firebase Email/Password authentication and Firebase Realtime Database live sensor monitoring for both Farmer and Cold Storage Monitoring pages.

## Upload the website

1. Extract this ZIP on your computer.
2. Open the extracted folder. `index.html` must be directly inside this folder, alongside `app.js`, `styles.css`, and `firebase-config.js`.
3. Open your GitHub repository: `AryavardhanJain-2006/AgriSetu`.
4. Upload/replace the **contents** of this folder in the repository root. Do not upload only the ZIP file and do not put the files inside an extra nested `AgriSetu-main` folder.
5. Commit the changes to the branch/folder configured for GitHub Pages.
6. Wait for the GitHub Pages deployment to complete, then open `https://aryavardhanjain-2006.github.io/AgriSetu/` and hard-refresh the page (Ctrl+Shift+R).

## Firebase configuration already filled

`firebase-config.js` is populated with the Firebase Web App values shown for project `agrisetu-479fe`. The public Web API key is not an Admin SDK credential. Do not add a Firebase service-account JSON, database secret, device password, or `ESP32_Firebase/secrets.h` to the repository.

## Required one-time Firebase setup for portal users

The live sensor card appears only after a user signs in with Firebase Authentication and has an administrator-approved `/userAccess/{uid}` record.

For the Cold Storage account assigned to Agra Cold Storage, add this record in Firebase Console → Realtime Database → Data, using the actual cold-storage user's Firebase Auth UID:

Path: `/userAccess/COLD_STORAGE_USER_UID`

```json
{
  "active": true,
  "role": "Cold Storage",
  "facilityId": "COLD_BOX_01",
  "storageName": "Agra Cold Storage"
}
```

For a farmer who is allowed to view Agra Cold Storage, add this record using that farmer's actual Firebase Auth UID:

Path: `/userAccess/FARMER_USER_UID`

```json
{
  "active": true,
  "role": "Farmer",
  "facilityIds": {
    "COLD_BOX_01": true
  }
}
```

Grant a farmer only the facilities where the farmer has an accepted booking. Users cannot grant themselves access; the Realtime Database rules deny client writes to `/userAccess`.

New portal users register through the website. Registration creates an Authentication account, profile and pending access request. A project administrator must approve the requested role and facility by adding the corresponding `/userAccess/{uid}` record.

## Sensor data source

The ESP32 writes to:

- `/facilities/COLD_BOX_01/latest` — overwritten about every 5 seconds.
- `/facilities/COLD_BOX_01/history/slot_N` — one point about every 60 seconds, rotating through 10,080 slots (seven days).

Both Monitoring panels read these same facility records. The Farmer sees the facility only when it is included in `facilityIds`; the Cold Storage user sees only its assigned `facilityId`.

## Arduino firmware folder

The working firmware and headers are also included under `ESP32_Firebase/AgriSetu_ESP32_Firebase/` as a reference. Open that inner folder as the Arduino sketch folder. Copy `secrets.example.h` to `secrets.h` locally and fill in your credentials. `secrets.h` is ignored by `.gitignore` and is not present in this ZIP.

## Current single-device write rule

The `database.rules.json` file matches the rules that were tested successfully for the current ESP32 UID `AcyUBsOW9ePKOo87aUUxf0RYd9c2` and facility `COLD_BOX_01`. This current diagnostic deployment allows that one authenticated device UID to write to that one facility. If you replace the ESP32 or add another device/facility, update the two device `.write` rules with a properly tested device authorization policy before deploying new rules.

The existing `deviceAccess` data node may remain in the database, but this single-device rule version currently uses the explicit UID/facility condition rather than looking up `deviceAccess` dynamically.

## Optional: redeploy the rules from this repository

The repository contains `firebase.json`, `.firebaserc`, and `database.rules.json`. With Firebase CLI installed and signed in to the correct project, run:

```bash
firebase deploy --only database
```

Do not deploy the rules if you have made later changes in the Firebase Console that are not reflected in this repository.

## What remains local to the browser

Firebase authentication, sensor readings, and the minimal booking metadata needed for cross-device request approval and monitoring authorization are shared across devices. The rest of the legacy booking details, inventory, marketplace, payment-demo and notification workflows still use browser `localStorage`; those workflows have not all been migrated. Bookings created before this update are not automatically migrated into the shared booking path.


## Deploy booking-based monitoring access (no Blaze plan)

Upload the updated `app.js`, `firebase-integration.js`, `index.html`, `firebase-config.js` and `database.rules.json` to the GitHub Pages repository. No `functions/` folder or Cloud Functions deployment is required.

In Firebase Console, open **Realtime Database → Rules**, replace the rules with the complete `database.rules.json` file and click **Publish**. The app synchronizes new farmer bookings at `/storageBookings/{facilityId}/{bookingId}`. When the matching Cold Storage operator accepts one, the app writes the farmer's grant under `/monitoringAccess/{farmerUid}/facilityIds/{facilityId}`. Database rules prevent farmers from creating their own grants.

For every Cold Storage account, the administrator must set its exact facility mapping in `/userAccess/{coldStorageUid}`. For every installed sensor, create a separate Firebase Authentication device user and add `/deviceAccess/{deviceUid}` with `enabled: true` and that facility's `facilityId`. Set the ESP32 `FACILITY_ID` to the same value.
