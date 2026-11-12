import { defineConfig } from 'wxt';

// E2E builds may talk to a fake Canvas on localhost. Release builds never can.
const e2e = process.env.E2E === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ define: { __E2E__: JSON.stringify(e2e) } }),
  manifest: {
    name: 'Canvas companion (working title)',
    description: 'Read-only view of your own Canvas courses and grades. Nothing leaves your browser.',
    // sidePanel: the UI. storage: remembers which Canvas you connected. scripting: the
    // in-tab fallback transport. No host access is granted at install time.
    permissions: ['sidePanel', 'storage', 'scripting'],
    // Asked for one origin at a time, when the student clicks Connect.
    optional_host_permissions: ['https://*/*'],
    host_permissions: e2e ? ['http://localhost/*'] : [],
    action: { default_title: 'Open Canvas companion' },
  },
});
