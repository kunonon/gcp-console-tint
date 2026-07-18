import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  webExt: {
    disabled: true,
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'GCP Console Tint',
    action: {},
    permissions: ['storage'],
  },
});
