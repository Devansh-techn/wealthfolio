// Regression guard for the "unstyled /login and /signup" bug.
// Root cause: the shared UI stylesheet (styles/app.css) was imported only by the lazy AppLayout, so PUBLIC routes
// (auth, legal, 404, toasts, loaders) rendered with browser defaults until a protected page had been visited.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const src = (p) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const cssImports = (file) => [...src(file).matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((m) => resolve(dirname(resolve(__dirname, '..', file)), m[1]));
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const definedClasses = (files) => new Set(files.flatMap((f) => [...stripComments(readFileSync(f, 'utf8')).matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((m) => m[1])));
const usedClasses = (file) => new Set([...src(file).matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)].flatMap((m) => (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)).filter((c) => c && !c.endsWith('-'))); // 'notice-${tone}' etc. are dynamic prefixes, not class names

describe('global stylesheet loading', () => {
  const entry = cssImports('main.jsx');
  const names = entry.map((p) => p.split('/').slice(-1)[0]);

  it('the app entry point imports the base, shared-UI and auth stylesheets (not just the lazy app layout)', () => {
    expect(names).toEqual(expect.arrayContaining(['index.css', 'app.css', 'auth.css']));
    expect(names.indexOf('index.css')).toBeLessThan(names.indexOf('app.css')); // tokens/base first
    expect(names.indexOf('app.css')).toBeLessThan(names.indexOf('auth.css'));  // auth overrides shared primitives
  });

  it('every class used by public/auth/shared-UI components is defined in a globally loaded stylesheet', () => {
    const defined = definedClasses(entry);
    const files = ['pages/AuthPages.jsx', 'pages/Legal.jsx', 'pages/NotFound.jsx', 'pages/SetupRequired.jsx', 'components/ErrorBoundary.jsx', 'components/ui/Form.jsx', 'components/ui/Feedback.jsx', 'contexts/ToastContext.jsx'];
    const missing = {};
    for (const f of files) {
      const m = [...usedClasses(f)].filter((c) => !defined.has(c));
      if (m.length) missing[f] = m;
    }
    expect(missing).toEqual({});
  });

  it('the lazy app layout no longer owns the shared stylesheet', () => {
    expect(src('layouts/AppLayout.jsx')).not.toMatch(/styles\/app\.css/);
  });

  it('landing-page navbar buttons are scoped so they cannot override the application buttons', () => {
    const css = stripComments(src('components/Navbar.css'));
    for (const cls of ['btn-primary-sm', 'btn-secondary']) {
      const rules = [...css.matchAll(new RegExp(`(^|\\n)([^{}\\n]*\\.${cls}[^{}\\n]*)\\{`, 'g'))].map((m) => m[2].trim());
      expect(rules.length).toBeGreaterThan(0);
      for (const sel of rules) expect(sel, `${sel} must be scoped under .navbar`).toMatch(/\.navbar[\s>]/);
    }
  });
});
