# AgriSetu AI Analysis Add-on (additive files only)

This package is designed for the supplied `AgriSetu-main` project. It does not modify `app.js`, Firebase configuration, Firebase rules, ESP32 files, or existing data.

## Files
- `ai-analysis-addon.js` — injects AI Analysis buttons into Farmer and Cold Storage Dashboard/Monitoring pages; provides image upload, live camera capture, crop selection, shelf-life demo calculation, and downloadable text report.
- `ai-analysis-addon.css` — add-on styles.
- `ai-shelf-life-config.json` — editable values used by the add-on.
- `ai-shelf-life-config.csv` — spreadsheet-friendly copy of the same values.

## One unavoidable integration step
A browser cannot execute a new JavaScript file merely because it exists in the GitHub repository. To make the buttons appear inside the existing app, add this one script tag to the bottom of the existing `index.html`, immediately after the current `firebase-integration.js` script:

```html
<script src="ai-analysis-addon.js"></script>
```

No other existing file needs to be edited. The add-on loads its CSS automatically and reads `ai-shelf-life-config.json` from the same website root. If you cannot change `index.html` at all, the add-on cannot automatically add buttons to the current app; it can only be opened as a separate page/tool.

## Upload
Upload all four add-on files to the same GitHub Pages root folder as `index.html`. Do not replace existing Firebase files.

## How it works
1. On Farmer or Cold Storage Dashboard/Monitoring pages, click **AI Produce Analysis**.
2. On a monitoring card, click **Scan / Analyse this produce** to carry its displayed batch ID into the report.
3. Upload a photo or start the live camera and capture a frame.
4. The add-on loads TensorFlow.js + MobileNetV2 from public CDNs and attempts ImageNet-label matching for the seven supported vegetables.
5. Confirm/correct the crop using the dropdown, choose the visible condition, and run the estimate.
6. Generate a downloadable text report.

Camera access requires HTTPS (GitHub Pages qualifies) and browser permission. Image model recognition requires internet access. If the model cannot recognize a supported crop confidently, manually choose the correct crop.

## Edit demonstration values
Edit `ai-shelf-life-config.json` directly in GitHub or locally. For each crop:
- `baseShelfLifeDays`: editable base demonstration days.
- `temperatureC`: displayed reference value.
- `humidityPercent`: displayed reference value.
- `visualAdjustments`: multipliers applied to base days for the selected visible condition.

The CSV is a convenient spreadsheet view, but the running application reads the JSON file. If you edit the CSV, copy the changes into the JSON too.

## Important limitations
- MobileNetV2 is a general ImageNet image classifier, not a purpose-trained seven-vegetable or freshness model. Recognition can be uncertain; the dropdown allows manual correction.
- Remaining shelf life is a demonstration estimate calculated from the editable base days and manually selected visible condition. It is not scientifically validated and must not be used for food-safety decisions.
- The add-on is separate from ESP32 live sensor monitoring. It does not write to Firebase, change stored batches, or alter existing monitoring data.
- Browser camera access is not the same as a connected cold-room camera feed; it uses the device camera running the website.
