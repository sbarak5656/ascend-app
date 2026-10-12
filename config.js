/* Build-time configuration.
   contentUrl: where the app looks for live program/library updates (content.json).
   - Web / PWA: a relative path works ("content.json").
   - Android app: must be the absolute https URL of the hosted content.json. */
window.APP_CONFIG = { contentUrl: "content.json", uiUrl: "ui.json" };
