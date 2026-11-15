#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <math.h>
#include <time.h>
#include "DHT.h"
#include "secrets.h"
#include "firebase_ca_roots.h"

// --- Pin Configuration: unchanged from the supplied prototype ---
#define DHTPIN 4
#define DHTTYPE DHT22
#define MQ5_ANALOG_PIN 34
#define MQ135_ANALOG_PIN 35       // MQ-135 AOUT via its own voltage divider
#define LCD_SDA_PIN 21
#define LCD_SCL_PIN 22
#define LCD_I2C_ADDRESS 0x27      // Change to 0x3F if your LCD backpack uses that address

// --- Voltage Divider Constants (R1 = 1kΩ, R2 = 2kΩ) ---
const float R1 = 1000.0;
const float R2 = 2000.0;
const float DIVIDER_RATIO = (R1 + R2) / R2;

// MQ-135 uses its own 2.2kΩ / 3.3kΩ divider, independent of the MQ-5 divider.
const float MQ135_R1 = 2200.0f;
const float MQ135_R2 = 3300.0f;
const float MQ135_DIVIDER_RATIO = (MQ135_R1 + MQ135_R2) / MQ135_R2;

// Starting values for the common MQ135 Rs/R0 approximation.
// IMPORTANT: RL is the load resistance on your MQ-135 module. R0 must be
// calibrated for your specific sensor in known clean air after burn-in.
// The displayed result is an approximate CO2-equivalent (eCO2) estimate,
// not a selective/accurate CO2 measurement.
const float MQ135_CIRCUIT_VOLTAGE = 5.0f;
const float MQ135_RL_KOHM = 10.0f;
const float MQ135_R0_KOHM = 76.63f;  // Starting reference only; calibrate for your module
const float MQ135_PARA = 116.602f;
const float MQ135_PARB = 2.769f;

LiquidCrystal_I2C lcd(LCD_I2C_ADDRESS, 16, 2);

// Live value every 5 s; one historical point every 60 s.
// This keeps the Realtime Database workload much lower than a 1.5 s history write.
const unsigned long LIVE_WRITE_INTERVAL_MS = 5000UL;
const unsigned long HISTORY_WRITE_INTERVAL_MS = 60000UL;
const unsigned long TOKEN_REFRESH_MARGIN_MS = 120000UL;
// 10,080 minute slots = 7 days. Slots are overwritten weekly to bound storage.
const uint32_t HISTORY_SLOT_COUNT = 10080UL;

DHT dht(DHTPIN, DHTTYPE);
Preferences preferences;
WiFiClientSecure secureClient;
String idToken;
String refreshToken;
String deviceUid;
unsigned long idTokenExpiresAt = 0;
unsigned long lastLiveWrite = 0;
unsigned long lastHistoryWrite = 0;
unsigned long lastClockSyncAttempt = 0;
bool clockReady = false;

String databaseBaseUrl() {
  String url = String(FIREBASE_DATABASE_URL);
  while (url.endsWith("/")) url.remove(url.length() - 1);
  return url;
}

String urlEncode(const String &value) {
  const char *hex = "0123456789ABCDEF";
  String encoded;
  for (size_t i = 0; i < value.length(); i++) {
    const uint8_t c = static_cast<uint8_t>(value[i]);
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
        (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~') {
      encoded += static_cast<char>(c);
    } else {
      encoded += '%';
      encoded += hex[(c >> 4) & 0x0F];
      encoded += hex[c & 0x0F];
    }
  }
  return encoded;
}

bool postJson(const String &url, const String &payload, String &responseBody) {
  HTTPClient http;
  if (!http.begin(secureClient, url)) {
    Serial.println("HTTPS begin failed");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(12000);
  const int code = http.POST(payload);
  responseBody = code > 0 ? http.getString() : http.errorToString(code);
  Serial.printf("Firebase POST/REST response: %d\n", code);
  if (code < 200 || code >= 300) Serial.println(responseBody);
  http.end();
  return code >= 200 && code < 300;
}

bool authenticateDevice() {
  StaticJsonDocument<384> requestDoc;
  requestDoc["email"] = DEVICE_AUTH_EMAIL;
  requestDoc["password"] = DEVICE_AUTH_PASSWORD;
  requestDoc["returnSecureToken"] = true;
  String body;
  serializeJson(requestDoc, body);

  const String url = String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=") + FIREBASE_API_KEY;
  String response;
  if (!postJson(url, body, response)) {
    Serial.println("Firebase device sign-in failed. Check device email/password and API key.");
    return false;
  }

  StaticJsonDocument<1536> responseDoc;
const DeserializationError error = deserializeJson(responseDoc, response);

if (error ||
    !responseDoc["idToken"].is<const char *>() ||
    !responseDoc["refreshToken"].is<const char *>() ||
    !responseDoc["localId"].is<const char *>()) {

  Serial.println("Could not parse Firebase sign-in response.");
  return false;
}

idToken = responseDoc["idToken"].as<String>();
refreshToken = responseDoc["refreshToken"].as<String>();

// Get the actual authenticated Firebase UID
deviceUid = responseDoc["localId"].as<String>();

Serial.println("--------------------------------");
Serial.println("FIREBASE AUTHENTICATION SUCCESS");
Serial.print("Authenticated Device UID: ");
Serial.println(deviceUid);
Serial.println("--------------------------------");
  const unsigned long seconds = responseDoc["expiresIn"].as<String>().toInt() > 0
      ? responseDoc["expiresIn"].as<String>().toInt() : 3600UL;
  idTokenExpiresAt = millis() + seconds * 1000UL;
  preferences.putString("refreshToken", refreshToken);
  Serial.println("Firebase device authenticated.");
  return true;
}

bool refreshDeviceToken() {
  if (refreshToken.isEmpty()) return authenticateDevice();
  const String form = String("grant_type=refresh_token&refresh_token=") + urlEncode(refreshToken);
  HTTPClient http;
  const String url = String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY;
  if (!http.begin(secureClient, url)) return false;
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  http.setTimeout(12000);
  const int code = http.POST(form);
  const String response = code > 0 ? http.getString() : http.errorToString(code);
  http.end();
  if (code < 200 || code >= 300) {
    Serial.printf("Token refresh failed: HTTP %d\n", code);
    Serial.println(response);
    idToken = "";
    return authenticateDevice();
  }

  StaticJsonDocument<1536> responseDoc;
  if (deserializeJson(responseDoc, response)) return false;
  idToken = responseDoc["id_token"].as<String>();
  refreshToken = responseDoc["refresh_token"].as<String>();
  const unsigned long seconds = responseDoc["expires_in"].as<String>().toInt() > 0
      ? responseDoc["expires_in"].as<String>().toInt() : 3600UL;
  if (idToken.isEmpty() || refreshToken.isEmpty()) return false;
  idTokenExpiresAt = millis() + seconds * 1000UL;
  preferences.putString("refreshToken", refreshToken);
  Serial.println("Firebase ID token refreshed.");
  return true;
}

bool ensureDeviceToken() {
  if (idToken.isEmpty()) {
    if (!refreshToken.isEmpty()) return refreshDeviceToken();
    return authenticateDevice();
  }
  // Rollover-safe millis comparison.
  if ((long)(idTokenExpiresAt - millis()) <= (long)TOKEN_REFRESH_MARGIN_MS) {
    return refreshDeviceToken();
  }
  return true;
}


// Four small custom LCD symbols: thermometer, humidity drop, CO2/air bubbles,
// and methane flame. All four sensor values remain visible at the same time.
byte lcdThermometer[8] = {
  B00100, B01010, B01010, B01110, B01110, B11111, B11111, B01110
};
byte lcdDroplet[8] = {
  B00100, B00100, B01010, B10001, B10001, B10001, B01110, B00000
};
byte lcdCO2[8] = {
  B00100, B01010, B00100, B00000, B01110, B10001, B01110, B00000
};
byte lcdFlame[8] = {
  B00100, B00110, B00100, B01110, B10101, B10101, B01110, B00000
};

void initializeLCD() {
  Wire.begin(LCD_SDA_PIN, LCD_SCL_PIN);
  lcd.init();
  lcd.backlight();
  lcd.createChar(0, lcdThermometer);
  lcd.createChar(1, lcdDroplet);
  lcd.createChar(2, lcdCO2);
  lcd.createChar(3, lcdFlame);
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("AgriSetu Sensors");
  lcd.setCursor(0, 1);
  lcd.print("Starting...");
}

float readMQ135CO2Equivalent(int &rawADC, float &pinVoltage,
                             float &sensorVoltage, float &rsKohm) {
  rawADC = analogRead(MQ135_ANALOG_PIN);
  pinVoltage = (rawADC / 4095.0f) * 3.3f;
  sensorVoltage = pinVoltage * MQ135_DIVIDER_RATIO;

  // The MQ-135 module's AO voltage is treated as the voltage across RL.
  // Rs = ((Vc / Vrl) - 1) * RL. A wrong RL/R0 makes the estimate inaccurate.
  if (sensorVoltage <= 0.01f || sensorVoltage >= MQ135_CIRCUIT_VOLTAGE) {
    rsKohm = NAN;
    return NAN;
  }

  rsKohm = ((MQ135_CIRCUIT_VOLTAGE / sensorVoltage) - 1.0f) * MQ135_RL_KOHM;
  if (!isfinite(rsKohm) || rsKohm <= 0.0f || MQ135_R0_KOHM <= 0.0f) {
    return NAN;
  }

  const float ratio = rsKohm / MQ135_R0_KOHM;
  const float estimatedPPM = MQ135_PARA * powf(ratio, -MQ135_PARB);
  if (!isfinite(estimatedPPM) || estimatedPPM < 0.0f) return NAN;
  return estimatedPPM > 9999.0f ? 9999.0f : estimatedPPM;
}

void formatCompactPpm(float value, char *buffer, size_t bufferSize) {
  if (!isfinite(value)) {
    snprintf(buffer, bufferSize, "----p");
    return;
  }
  const int rounded = (int)constrain(lroundf(value), 0L, 9999L);
  // "p" is a compact LCD abbreviation for ppm.
  snprintf(buffer, bufferSize, "%04dp", rounded);
}

// Write one exact 8-character LCD field: 1 custom symbol + 7 text cells.
// The right-hand field always starts at LCD column 8 on both rows.
void writeLCDField(uint8_t column, uint8_t row,
                   uint8_t symbol, const char *labelAndValue) {
  lcd.setCursor(column, row);
  lcd.write((uint8_t)symbol);

  bool padding = false;
  for (uint8_t i = 0; i < 7; i++) {
    char ch = padding ? ' ' : labelAndValue[i];
    if (ch == '\0') {
      padding = true;
      ch = ' ';
    }
    lcd.write((uint8_t)ch);
  }
}

void updateLCD(float temperature, float humidity,
               float co2EquivalentPPM, float methanePPM) {
  char temperatureField[8] = "T:--.-C";
  char humidityField[8] = "H:--%";
  char co2PpmText[6];
  char methanePpmText[6];
  char co2Field[8] = "C:----p";
  char methaneField[8] = "M:----p";

  // Each field contains at most seven visible characters after its icon.
  if (isfinite(temperature)) {
    snprintf(temperatureField, sizeof(temperatureField), "T:%.1fC", temperature);
  }

  if (isfinite(humidity)) {
    snprintf(humidityField, sizeof(humidityField), "H:%.0f%%", humidity);
  }

  formatCompactPpm(co2EquivalentPPM, co2PpmText, sizeof(co2PpmText));
  formatCompactPpm(methanePPM, methanePpmText, sizeof(methanePpmText));
  snprintf(co2Field, sizeof(co2Field), "C:%.5s", co2PpmText);
  snprintf(methaneField, sizeof(methaneField), "M:%.5s", methanePpmText);

  // Row 1: [thermometer] T:25.4C [drop] H:60%
  // Row 2: [CO2]         C:0400p [flame] M:0035p
  // The second group begins at column 8 in both rows.
  writeLCDField(0, 0, 0, temperatureField);
  writeLCDField(8, 0, 1, humidityField);
  writeLCDField(0, 1, 2, co2Field);
  writeLCDField(8, 1, 3, methaneField);
}

String makeReadingJson(float temperature, float humidity, float methane,
                       int rawADC, float sensorVoltage, unsigned long deviceTime) {
  StaticJsonDocument<512> doc;
  doc["facility_id"] = FACILITY_ID;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["methane_ppm"] = methane;
  doc["raw_adc"] = rawADC;
  doc["sensor_voltage"] = sensorVoltage;
  doc["device_timestamp_ms"] = deviceTime;
  // Use a numeric Unix timestamp in milliseconds. This directly satisfies
  // the Realtime Database rule: received_at must be a number greater than 0.
  const uint64_t receivedAtMs = static_cast<uint64_t>(time(nullptr)) * 1000ULL;
  doc["received_at"] = receivedAtMs;
  String payload;
  serializeJson(doc, payload);
  return payload;
}

bool writeFirebasePath(const String &path, const String &payload, const char *method) {
  if (!ensureDeviceToken()) {
    Serial.println("No valid Firebase ID token; data not sent.");
    return false;
  }

  Serial.print("Authenticated Firebase UID used for write: ");
  Serial.println(deviceUid.length() ? deviceUid : String("(not printed yet; inspect initial sign-in log)"));

  const String url = databaseBaseUrl() + path + ".json?auth=" + urlEncode(idToken);
  HTTPClient http;
  if (!http.begin(secureClient, url)) {
    Serial.println("Could not open Firebase Realtime Database HTTPS connection.");
    return false;
  }
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(12000);
  Serial.println("Firebase write diagnostic:");
Serial.print("Target path: ");
Serial.println(path);

Serial.println("Payload:");
Serial.println(payload);
  int code = (strcmp(method, "PUT") == 0) ? http.PUT(payload) : http.POST(payload);
  String response = code > 0 ? http.getString() : http.errorToString(code);
  http.end();

  // Firebase returns this exact response when a valid request is denied by
  // Realtime Database Security Rules. Refreshing the same user's token cannot
  // fix a UID/facility/rule mismatch, so report it directly instead of retrying.
  if (code == 401 && response.indexOf("Permission denied") >= 0) {
    Serial.println("Database rules rejected this write (Permission denied).");
    Serial.println("Compare the UID printed above with the child key under /deviceAccess.");
    Serial.println("Also confirm facilityId is exactly COLD_BOX_01 and rules are published.");
    Serial.println("The ID token was accepted far enough to reach the database rules; refreshing it will not fix this denial.");
  } else if (code == 401) {
    Serial.println("Firebase returned 401 for an authentication/token error. Refreshing token once.");
    if (!refreshDeviceToken()) return false;
    const String retryUrl = databaseBaseUrl() + path + ".json?auth=" + urlEncode(idToken);
    if (!http.begin(secureClient, retryUrl)) return false;
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(12000);
    code = (strcmp(method, "PUT") == 0) ? http.PUT(payload) : http.POST(payload);
    response = code > 0 ? http.getString() : http.errorToString(code);
    http.end();
  }

  if (code >= 200 && code < 300) return true;
  Serial.printf("Firebase write failed. HTTP %d\n", code);
  Serial.println(response);
  if (code == 401 || code == 403) {
    Serial.println("Check Firebase Auth device account, deviceAccess UID mapping and database rules.");
  }
  return false;
}

bool syncClock() {
  lastClockSyncAttempt = millis();
  configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
  struct tm timeInfo;
  if (getLocalTime(&timeInfo, 15000)) {
    const time_t epoch = time(nullptr);
    if (epoch > 1700000000) {
      clockReady = true;
      Serial.println("System clock synchronized; HTTPS certificate validation is ready.");
      return true;
    }
  }
  clockReady = false;
  Serial.println("NTP time sync failed. Firebase HTTPS writes will wait until time is valid.");
  return false;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long started = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - started < 30000UL) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected.");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("Wi-Fi connection timed out; will retry in loop.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  initializeLCD();
  dht.begin();
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);

  // TLS certificate validation is enabled. Do not replace with setInsecure().
  secureClient.setCACert(FIREBASE_ROOT_CA_BUNDLE);

  preferences.begin("agrisetu-fb", false);

// Clear the previously saved Firebase refresh token.
// This forces a fresh login using secrets.h.
preferences.remove("refreshToken");

refreshToken = "";

Serial.println("Old Firebase token cleared.");
Serial.println("A fresh device login will be performed.");

connectWiFi();
  if (WiFi.status() == WL_CONNECTED) syncClock();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    delay(1000);
    return;
  }

  if (!clockReady) {
    if (millis() - lastClockSyncAttempt >= 30000UL) syncClock();
    delay(250);
    return;
  }

  const time_t currentEpoch = time(nullptr);
  if (currentEpoch <= 1700000000) {
    clockReady = false;
    return;
  }

  const unsigned long now = millis();
  if (now - lastLiveWrite < LIVE_WRITE_INTERVAL_MS) {
    delay(50);
    return;
  }
  lastLiveWrite = now;

  // 1. Read environmental sensors.
  const float temperature = dht.readTemperature();
  const float humidity = dht.readHumidity();

  // 2. Read MQ-5 ADC using the original 1kΩ / 2kΩ voltage divider.
  const int rawGasADC = analogRead(MQ5_ANALOG_PIN);
  const float pinVoltage = (rawGasADC / 4095.0f) * 3.3f;
  const float actualSensorVoltage = pinVoltage * DIVIDER_RATIO;

  // 3. Original dynamic gas estimate calculation: retained unchanged.
  const float v_clean_air = 0.4f;
  float gasPPM = 1.9f;
  if (actualSensorVoltage > v_clean_air) {
    const float deltaV = actualSensorVoltage - v_clean_air;
    gasPPM = 1.9f + (deltaV * 65.0f) + (deltaV * deltaV * 30.0f);
    if (gasPPM > 500.0f) gasPPM = 500.0f;
  } else {
    gasPPM = 1.9f - ((v_clean_air - actualSensorVoltage) * 0.5f);
    if (gasPPM < 1.0f) gasPPM = 1.0f;
  }

  // 4. New MQ-135 reading. This is an approximate CO2-equivalent estimate.
  int rawMQ135ADC = 0;
  float mq135PinVoltage = 0.0f;
  float mq135SensorVoltage = 0.0f;
  float mq135RsKohm = NAN;
  const float co2EquivalentPPM = readMQ135CO2Equivalent(
      rawMQ135ADC, mq135PinVoltage, mq135SensorVoltage, mq135RsKohm);

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("Warning: Failed to read from DHT22 sensor; skipped this upload.");
    return;
  }

  updateLCD(temperature, humidity, co2EquivalentPPM, gasPPM);

  Serial.printf("Facility: %s | Temp: %.1f C | Hum: %.1f %% | MQ5 ADC: %d | MQ5 pin: %.2f V | MQ5 sensor: %.2f V | Methane estimate: %.1f ppm | MQ135 ADC: %d | MQ135 sensor: %.2f V | MQ135 Rs: %.2f kOhm | CO2-equivalent estimate: %.0f ppm\n",
                FACILITY_ID, temperature, humidity, rawGasADC,
                pinVoltage, actualSensorVoltage, gasPPM,
                rawMQ135ADC, mq135SensorVoltage, mq135RsKohm,
                co2EquivalentPPM);

  const String payload = makeReadingJson(temperature, humidity, gasPPM,
                                         rawGasADC, actualSensorVoltage, now);

  // Latest value is overwritten every 5 seconds for the live dashboard.
  const String latestPath = String("/facilities/") + FACILITY_ID + "/latest";
  if (writeFirebasePath(latestPath, payload, "PUT")) {
    Serial.println("Latest sensor reading saved to Firebase.");
  }

  // Historical data is appended once per minute to reduce free-tier write usage.
  if (now - lastHistoryWrite >= HISTORY_WRITE_INTERVAL_MS) {
    lastHistoryWrite = now;
    const uint32_t slot = (uint32_t)((currentEpoch / 60) % HISTORY_SLOT_COUNT);
    const String historyPath = String("/facilities/") + FACILITY_ID + "/history/slot_" + String(slot);
    if (writeFirebasePath(historyPath, payload, "PUT")) {
      Serial.printf("Historical sensor sample saved to rolling 7-day slot %lu.\n", (unsigned long)slot);
    }
  }
}
