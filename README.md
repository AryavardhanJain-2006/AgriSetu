# AgriSetu AI Analysis add-on (standalone folder)

This add-on is designed to be uploaded as a **new `ai-analysis/` folder** into the root of the existing AgriSetu GitHub repository. It does not require replacing or editing `index.html`, `app.js`, `firebase-integration.js`, `firebase-config.js`, or any other existing project file.

## Upload

1. Extract the supplied ZIP.
2. Upload the complete `ai-analysis` folder to the root of the existing GitHub repository (at the same level as `index.html` and `firebase-config.js`).
3. Commit/push. No existing files need to be replaced.
4. Open `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/ai-analysis/`.
5. Sign in to AgriSetu in the same browser first. The add-on reuses the existing Firebase app configuration and browser Firebase Auth session when available.
6. Allow camera access. GitHub Pages is HTTPS, which is required by browser camera APIs.

## Features

- Live camera capture and image upload.
- Browser-side MobileNetV2 ImageNet classification, with crop mapping and manual crop confirmation.
- Temperature, humidity, optional CO2, and storage duration inputs.
- Optional authorized latest sensor read from `/facilities/{facilityId}/latest` using the existing Firebase configuration and signed-in session.
- Shelf-life calculation copied from `AgriSetu.ipynb`, Cell 7: six crop profiles, default profile, 0.98 visual freshness default, Q10 temperature factor, humidity factor, CO2 factor, combined degradation, remaining-life calculation, spoilage calculation, and original risk thresholds.
- Local report history stored in the current browser, keyed by Firebase UID where available.

## Important limitations (do not skip)

1. The custom ResNet-18 trained weights are not available in this repository. This add-on uses MobileNetV2 from a CDN as a fallback. It is **not** the notebook's trained ResNet-18 and may not recognize every one of the 15 notebook classes. If the label cannot be mapped, select the crop manually. Confidence is shown only when an ImageNet label maps to a crop.
2. The classifier identifies object category; it does not measure visual rot, bruising, or freshness. The notebook's fixed visual freshness score of 0.98 is retained.
3. Your current MQ-5 is a methane/combustible-gas sensor, not a CO2 sensor. The add-on never treats methane as CO2. If CO2 is blank, it uses the crop profile's `base_co2` as the formula input and marks measured CO2 unavailable.
4. Because this is a folder-only addition and existing Firebase rules are not changed, reports are stored in browser localStorage only. They are not synchronized across devices and are not visible in the Cold Storage Portal. Secure cross-device sharing requires adding an authorized Firebase report path to Realtime Database Rules and integrating the report reader into the Cold Storage Portal; that cannot be achieved safely by uploading only static files without changing database permissions / portal code.
5. Sensor reads will work only if the signed-in user is already authorized by the current database rules to read that facility's `/latest` node. If not, enter readings manually or fix the existing facility authorization separately.

## Formula provenance

The calculation is taken from the uploaded `AgriSetu.ipynb`, Cell 7 (headed “AgriSetu Multimodal Shelf-Life & Spoilage Estimator”). The image transform in that notebook is 224×224 with ImageNet normalization for its ResNet-18; this browser fallback does not claim to reproduce that ResNet preprocessing or model.
