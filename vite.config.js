import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/disclaimer', '/privacy', '/terms'];
const PRIVATE_PATHS = ['/dashboard', '/portfolio', '/assets', '/transactions', '/screener', '/analytics', '/goals', '/budget', '/loans', '/watchlist', '/settings', '/profile', '/auth/', '/reset-password'];

// Injects the canonical/OpenGraph URL from VITE_SITE_URL and emits robots.txt + sitemap.xml.
// If VITE_SITE_URL is not set, URL-dependent tags are omitted rather than pointing at a wrong domain.
function seoPlugin(siteUrl) {
  const site = siteUrl.replace(/\/+$/, '');
  return {
    name: 'wealthfolio-seo',
    transformIndexHtml(html) {
      const withUrl = html
        .replaceAll('__SITE_URL__', site)
        .replace(/ *<!--\s*site-url:start\s*-->[\s\S]*?<!--\s*site-url:end\s*-->\n?/g, (block) => (site ? block.replace(/<!--[^>]*-->\n?/g, '') : ''));
      return withUrl;
    },
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /', ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`), site ? `Sitemap: ${site}/sitemap.xml` : ''].filter(Boolean).join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots}\n` });
      if (site) {
        const urls = PUBLIC_PATHS.map((p) => `  <url><loc>${site}${p === '/' ? '' : p}</loc></url>`).join('\n');
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n` });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), seoPlugin(env.VITE_SITE_URL ?? '')],
    build: { chunkSizeWarningLimit: 700 },
    test: { environment: 'node', include: ['src/**/*.test.{js,jsx}'], setupFiles: ['./src/__tests__/setup.js'] },
  };
});
