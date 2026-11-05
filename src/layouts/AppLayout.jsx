import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { LogOut, Menu, Receipt, User, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../contexts/DataContext';
import { useCurrency } from '../contexts/CurrencyContext';
import { useToast } from '../contexts/ToastContext';
import { PageLoader, ErrorState, InlineNotice } from '../components/ui/Feedback';
import NotificationBell from '../components/shell/NotificationBell';
import MarketStatus from '../components/shell/MarketStatus';
import ProfileMenu from '../components/shell/ProfileMenu';
import { BOTTOM, NAV, NAV_GROUPS, pageTitle } from '../components/shell/nav';
import { CURRENCIES } from '../lib/constants';
import { friendlyError } from '../lib/validation';

function useTheme(profile) {
  const pref = profile?.theme ?? 'dark';
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t = pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref;
      document.documentElement.setAttribute('data-theme', t);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      document.documentElement.removeAttribute('data-theme');
    };
  }, [pref]);
}

/** True on very narrow phones, where the header currency picker shows only the code. */
function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 420px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 420px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** "Thursday, 08 October 2026" (device-local date). */
function longDate(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}`;
}

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const data = useAppData();
  const { currency, setCurrency, fxStatus, fxError, retryFx, fxStale } = useCurrency();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [today, setToday] = useState(() => longDate(new Date()));
  const narrow = useNarrow();
  const mainRef = useRef(null);
  useTheme(data.profile);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const id = setInterval(() => setToday(longDate(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  const bottom = useMemo(() => NAV.filter((n) => BOTTOM.includes(n.to)), []);
  const logout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };
  const changeCurrency = async (c) => {
    try {
      await setCurrency(c);
    } catch (e) {
      toast.error(friendlyError(e, 'Could not save your currency.'));
    }
  };

  const groups = (onClick) =>
    NAV_GROUPS.map((g) => (
      <div key={g.label} className="nav-group" role="group" aria-label={g.label}>
        <p className="nav-label" aria-hidden="true">{g.label}</p>
        {g.items.map((n) => (
          <NavLink key={n.to} to={n.to} onClick={onClick} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <n.icon size={17} strokeWidth={1.6} aria-hidden="true" />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </div>
    ));

  return (
    <div className="app-shell">
      <a href="#app-main" className="skip-link">Skip to content</a>
      <aside className="sidebar" aria-label="Primary">
        <Link to="/" className="sidebar-logo">WealthFolio</Link>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {groups()}
          <button type="button" className="nav-link logout" onClick={logout}><LogOut size={17} strokeWidth={1.6} aria-hidden="true" /><span>Sign out</span></button>
        </nav>
      </aside>

      <div className="app-body">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" aria-label="Open menu" aria-expanded={drawer} onClick={() => setDrawer(true)}><Menu size={21} strokeWidth={1.6} /></button>
          <Link to="/" className="topbar-logo">WealthFolio</Link>
          <div className="topbar-title">
            <span className="topbar-page">{pageTitle(location.pathname)}</span>
            <span className="topbar-date">{today}</span>
          </div>
          <div className="topbar-right">
            <MarketStatus />
            <label className="sr-only" htmlFor="cur-select">Display currency</label>
            <select id="cur-select" className="currency-selector" value={currency} onChange={(e) => changeCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{narrow ? c.code : `${c.code} (${c.symbol})`}</option>)}
            </select>
            <NotificationBell />
            <ProfileMenu profile={data.profile} email={user?.email} onSignOut={logout} />
          </div>
        </header>

        {drawer && (
          <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
            <aside className="drawer" aria-label="Menu">
              <div className="drawer-head">
                <span className="sidebar-logo">WealthFolio</span>
                <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={21} strokeWidth={1.6} /></button>
              </div>
              <nav aria-label="Main navigation">
                {groups(() => setDrawer(false))}
                <NavLink to="/profile" onClick={() => setDrawer(false)} className="nav-link"><User size={17} strokeWidth={1.6} aria-hidden="true" /><span>Profile</span></NavLink>
                <button type="button" className="nav-link logout" onClick={logout}><LogOut size={17} strokeWidth={1.6} aria-hidden="true" /><span>Sign out</span></button>
              </nav>
            </aside>
          </div>
        )}

        <main id="app-main" ref={mainRef} tabIndex={-1} className="app-main">
          {data.isDemoMode && <InlineNotice tone="error">DEMO market data is active (development only). Prices shown are synthetic and are not saved.</InlineNotice>}
          {fxStatus === 'error' && (
            <InlineNotice tone="warn" action={<button type="button" className="link-sm" onClick={retryFx}>Retry</button>}>
              Exchange rates are unavailable ({fxError}). Amounts in other currencies can't be converted until they load.
            </InlineNotice>
          )}
          {fxStale && <InlineNotice tone="warn">Using cached exchange rates (live rates could not be refreshed).</InlineNotice>}
          {data.status === 'loading' && <PageLoader label="Loading your portfolio…" />}
          {data.status === 'error' && <ErrorState message={data.error} onRetry={data.reload} />}
          {data.status === 'ready' && <Outlet />}
        </main>

        <nav className="bottom-nav" aria-label="Quick navigation">
          {bottom.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `bn-link ${isActive ? 'active' : ''}`}>
              <n.icon size={19} strokeWidth={1.6} aria-hidden="true" /><span>{n.label.replace('AI ', '')}</span>
            </NavLink>
          ))}
          <button type="button" className="bn-link" onClick={() => setDrawer(true)}><Receipt size={19} strokeWidth={1.6} aria-hidden="true" /><span>More</span></button>
        </nav>
      </div>
    </div>
  );
}
