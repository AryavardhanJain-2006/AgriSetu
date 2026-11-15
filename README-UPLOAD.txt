AGRiSETU CORRECTED AI ADD-ON — UPLOAD GUIDE

Your uploaded AgriSetu-main (5).zip had file contents shifted/misnamed:
- ai-analysis-addon.js contained CSS text
- ai-analysis-addon.css contained JPEG image data
- ai-shelf-life-config.json contained JavaScript
- ai-shelf-life-config.csv contained JSON

This package restores the correct filenames and contents.

UPLOAD THESE ITEMS to the SAME GitHub Pages root folder as index.html:
1. ai-analysis-addon.js
2. ai-analysis-addon.css
3. ai-shelf-life-config.json
4. the complete ai-reference-images folder

Keep the existing index.html script line:
<script src="ai-analysis-addon.js"></script>
The add-on automatically loads ai-analysis-addon.css, so do not add another script or edit index.html.

Do NOT upload/replace app.js, index.html, Firebase files, database rules, ESP32 files, or styles.css.

The add-on injects an “AI Produce Analysis” button on Farmer and Cold Storage Dashboard/Monitoring pages. Monitoring cards also receive a batch-specific scan button.

After upload, commit changes, wait for GitHub Pages to publish, then hard-refresh (Ctrl+Shift+R).

Reference photos included: 4 potato, 1 onion, 2 tomato. The model is an indicative MobileNet embedding similarity demo, not a trained crop classifier; verify the selected crop manually. Shelf-life values are demonstration estimates editable in ai-shelf-life-config.json.
