# AgriSetu — MQ-135 + 16×2 LCD add-on

This package preserves the supplied AgriSetu website and the supplied ESP32 Firebase sketch. The only firmware additions are:
1. MQ-135 analog sensing and an approximate CO₂-equivalent (eCO₂) estimate.
2. A 16×2 I²C LCD showing all four sensor indicators simultaneously, using four custom symbols.

## LCD display layout

The LCD keeps all four readings visible together:

- Row 1: thermometer symbol + temperature in °C; droplet symbol + relative humidity in %.
- Row 2: CO₂/air symbol + estimated eCO₂-equivalent ppm; flame symbol + MQ-5 methane/gas estimate in ppm.

The `p` suffix is a compact abbreviation for `ppm`, used to fit a four-digit value on the 16-character row. The first row displays `C` after temperature and `%` after humidity.

## Pin connections

| Item | ESP32 connection |
|---|---|
| DHT22 DATA | GPIO 4 (unchanged) |
| MQ-5 AOUT | GPIO 34 through existing 1 kΩ / 2 kΩ divider (unchanged) |
| MQ-135 AOUT | GPIO 35 through new 2.2 kΩ / 3.3 kΩ divider |
| I²C LCD SDA | GPIO 21 through a bidirectional I²C level shifter |
| I²C LCD SCL | GPIO 22 through a bidirectional I²C level shifter |
| LCD address | 0x27 by default; change `LCD_I2C_ADDRESS` to 0x3F if needed |

### Power and wiring safety

- Use a regulated 5 V supply with enough current for both MQ sensor heater circuits and the LCD. A separate 5 V supply rated around 1 A is recommended for the sensor/LCD rail.
- Connect the external supply ground, ESP32 GND, DHT22 GND, MQ-5 GND, MQ-135 GND and LCD GND together.
- DHT22 VCC is connected to 3.3 V. For a bare 4-pin DHT22, add a 10 kΩ pull-up between DATA and 3.3 V. A sensor module may already contain the pull-up.
- MQ-5 and MQ-135 modules are powered from 5 V. Do not connect either analog output directly to the ESP32.
- MQ-5 keeps the original 1 kΩ series / 2 kΩ to GND divider.
- MQ-135 uses its own 2.2 kΩ series / 3.3 kΩ to GND divider. The divider midpoint goes to GPIO 35.
- Most 5 V LCD I²C backpacks pull SDA/SCL up to 5 V. Use a bidirectional I²C level shifter: LV=3.3 V, HV=5 V, GND=common. ESP32 GPIO21/22 go to LV-side SDA/SCL; LCD SDA/SCL go to HV-side SDA/SCL.
- The LCD library defaults to address 0x27. If the backlight works but no text appears, the backpack may use 0x3F.

## Arduino IDE libraries

Install:
- DHT sensor library (Adafruit)
- Adafruit Unified Sensor
- ArduinoJson
- LiquidCrystal_I2C (for example, the Frank de Brabander-compatible library)

ESP32 Wi-Fi, HTTPClient, WiFiClientSecure, Preferences, and Wire are provided by the ESP32 Arduino core.

## Setup

1. Open `ESP32_Firebase/AgriSetu_ESP32_Firebase` as the sketch folder in Arduino IDE.
2. Copy `secrets.example.h` to `secrets.h` in the same folder.
3. Fill `secrets.h` with your own Wi-Fi credentials, Firebase values, and dedicated ESP32 device login.
4. Never upload `secrets.h` to GitHub.
5. Install the libraries listed above, select the ESP32 board/port, then compile and upload.
6. Open Serial Monitor at 115200 baud.

## MQ-135 calibration and accuracy — important

The sketch calculates a CO₂-equivalent (eCO₂) estimate from the MQ-135 resistance ratio using a commonly used approximate curve equation. The initial constants in the sketch are only starting values:
- `MQ135_RL_KOHM = 10.0`
- `MQ135_R0_KOHM = 76.63`
- `MQ135_CIRCUIT_VOLTAGE = 5.0`

`RL` must match the load resistor in your particular MQ-135 module. `R0` must be calibrated for your sensor in clean reference air after the manufacturer's burn-in/preheat guidance (the Winsen manual specifies more than 48 hours initial preheating). The manufacturer describes MQ-135 as a broad air-quality sensor with cross-sensitivity to multiple gases; it is not a selective NDIR CO₂ meter. Therefore the LCD/Serial result is labelled as an estimate and must not be presented as laboratory-grade CO₂ ppm.

## Existing behaviour preserved

- The DHT22 GPIO 4 and MQ-5 GPIO 34 wiring are unchanged.
- The existing MQ-5 gas calculation is unchanged.
- The existing Firebase authentication, TLS validation, Wi-Fi reconnect, 5-second latest write, 60-second history write, and seven-day history slot logic are unchanged.
- The existing Firebase JSON payload and database security rules are unchanged. The new MQ-135 eCO₂ estimate is currently shown on the LCD and Serial Monitor only; it is not written to Firebase because the existing database rules reject additional telemetry fields. Publishing eCO₂ to the web dashboard would require a separate, explicit database-rules/frontend change.

## Files

- `AgriSetu_ESP32_Firebase.ino` — updated firmware
- `secrets.example.h` — safe credentials template; copy to `secrets.h`
- `firebase_ca_roots.h` — public Google Trust Services roots for TLS
- `Wiring/AgriSetu-ESP32-Wiring-Diagram.svg` and `.png` — wiring reference
