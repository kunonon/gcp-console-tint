import { showHintedTheme } from '../theme';

// Built to /theme-init.js and loaded by sidepanel/index.html as a classic script in <head>, where
// it blocks parsing: the theme class is on <html> before <body> exists, so the panel's first paint
// already has the right colours. The React bundle is a module script, which runs only after the
// document has been parsed and may paint first, and extension pages may not run inline scripts
// (CSP `script-src 'self'`), hence a file of its own.
export default defineUnlistedScript(showHintedTheme);
