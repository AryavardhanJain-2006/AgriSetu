/*
 * AgriSetu Firebase web configuration.
 * This is the public Firebase Web App config for project agrisetu-479fe.
 * The API key identifies the Firebase project; it is not an Admin SDK secret.
 * Access to Realtime Database is enforced by database.rules.json.
 */
window.AGRISETU_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBFrKb29RGOm4dMirGHPbfm0DiCXd0g7Gs",
  authDomain: "agrisetu-479fe.firebaseapp.com",
  databaseURL: "https://agrisetu-479fe-default-rtdb.firebaseio.com/",
  projectId: "agrisetu-479fe",
  storageBucket: "agrisetu-479fe.firebasestorage.app",
  messagingSenderId: "956925596627",
  appId: "1:956925596627:web:7f3b6f6597b7b113535526"
};

/*
 * Facility IDs must match the ESP32 FACILITY_ID and Firebase database paths.
 * A farmer sees a facility after an accepted booking creates /monitoringAccess/{uid}/facilityIds/{facilityId}.
 */
window.AGRISETU_FACILITIES = {
  COLD_BOX_01: {
    name: "Agra Cold Storage",
    location: "Agra",
    storageKey: "agra-cold-storage"
  },
  GREEN_FRESH_01: {
    name: "Green Fresh Storage",
    location: "Mathura",
    storageKey: "green-fresh-storage"
  },
  YAMUNA_COLD_01: {
    name: "Yamuna Cold Chain",
    location: "Firozabad",
    storageKey: "yamuna-cold-chain"
  }
};
