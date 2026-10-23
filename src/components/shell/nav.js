import { ArrowLeftRight, BarChart3, Briefcase, Calculator, Coins, Eye, LayoutDashboard, PiggyBank, Search, Settings, Target } from 'lucide-react';

export const NAV_GROUPS = [
  { label: 'Overview', items: [{ to: '/dashboard', label: 'Dashboard', title: 'Overview', icon: LayoutDashboard }] },
  { label: 'Wealth', items: [
    { to: '/portfolio', label: 'Portfolio', icon: Briefcase },
    { to: '/assets', label: 'Assets', icon: Coins },
    { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  ] },
  { label: 'Intelligence', items: [
    { to: '/screener', label: 'AI Screener', icon: Search },
    { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/watchlist', label: 'Watchlist', icon: Eye },
  ] },
  { label: 'Planning', items: [
    { to: '/goals', label: 'Goals', icon: Target },
    { to: '/budget', label: 'Budget', icon: PiggyBank },
    { to: '/loans', label: 'Loans', icon: Calculator },
  ] },
  { label: 'System', items: [{ to: '/settings', label: 'Settings', icon: Settings }] },
];

export const NAV = NAV_GROUPS.flatMap((g) => g.items);
export const BOTTOM = ['/dashboard', '/portfolio', '/transactions', '/screener'];

/** Header title for the current route. */
export function pageTitle(pathname) {
  const hit = NAV.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  if (hit) return hit.title ?? hit.label;
  return pathname.startsWith('/profile') ? 'Profile' : 'WealthFolio';
}
