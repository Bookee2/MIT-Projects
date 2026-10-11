// Site settings. Edit these, commit, and GitHub Pages redeploys.
window.CRE_CONFIG = {
  // Shown in the footer. Leave empty to hide the line.
  author: "",

  // SHA-256 of the passcode, as lowercase hex. Set to "" to turn the passcode screen off.
  // Default passcode: pulse2026
  // New hash: printf 'your-passcode' | sha256sum
  // The check runs in the browser, so this keeps casual visitors out. It is not real security.
  passcodeSha256: "2945ba80c868c7479df0a71fc738758d05cf1dfc25a58f086f7ddc2f69b39f81",

  // Default Gemini model name for the optional "Connect Gemini" feature.
  // Viewers can change it in the dialog if this name has been retired.
  geminiModel: "gemini-2.5-flash",
};
