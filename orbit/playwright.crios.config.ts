import base from './playwright.config';
// Same tests as Chrome on iPhone sees it: its user agent makes Orbit use the plain text box.
const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1';
export default { ...base, projects: [{ name: 'iphone-chrome', use: { ...base.projects![0].use, userAgent: ua } }] };
