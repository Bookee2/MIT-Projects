// Site settings. Edit these, commit, and GitHub Pages redeploys.
window.CRE_CONFIG = {
  // Shown in the header byline and footer. Leave empty to hide your name.
  author: "Kris Brown",
  // Header byline reads "Project Demo for <preparedFor> · <author>".
  preparedFor: "Colliers",

  // SHA-256 of the passcode, as lowercase hex. Set to "" to turn the passcode screen off.
  // Default passcode: pulse2026
  // New hash: printf 'your-passcode' | sha256sum
  // The check runs in the browser, so this keeps casual visitors out. It is not real security.
  passcodeSha256: "",

  // Default Gemini model name for the optional "Connect Gemini" feature.
  // Viewers can change it in the dialog if this name has been retired.
  geminiModel: "gemini-2.5-flash",
};
