import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

// E2E builds may talk to a fake Canvas on localhost. Release builds never can.
const e2e = process.env.E2E === '1';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ define: { __E2E__: JSON.stringify(e2e) } }),
  manifest: {
    name: 'Canvas Companion',
    // Changes on every build, so an unpacked install can notice a newer build on disk.
    version_name: `${version} (build ${new Date().toISOString().slice(0, 16).replace('T', ' ')})`,
    description: 'Your Canvas grades, checked. What to do next, what you need on what is left, and what your syllabus says that Canvas does not.',
    // sidePanel: the UI. storage: remembers which Canvas you connected. scripting: the
    // in-tab fallback transport. No host access is granted at install time.
    permissions: ['sidePanel', 'storage', 'scripting'],
    // Asked for one origin at a time, when the student clicks Connect.
    optional_host_permissions: ['https://*/*'],
    host_permissions: e2e ? ['http://localhost/*'] : [],
    action: { default_title: 'Open Canvas companion' },
  },
});
