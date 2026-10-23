import { Link } from 'react-router-dom';
import { LogOut, Settings, User } from 'lucide-react';
import { usePopover } from './usePopover';

export default function ProfileMenu({ profile, email, onSignOut }) {
  const { open, setOpen, ref } = usePopover();
  const name = profile?.full_name || email || 'Account';
  const initials = (profile?.full_name || email || '?').trim().slice(0, 1).toUpperCase();
  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className="avatar" aria-label="Account menu" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        {profile?.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{initials}</span>}
      </button>
      {open && (
        <div className="popover glass-panel profile-menu" role="menu" aria-label="Account">
          <div className="profile-menu-head">
            <strong>{name}</strong>
            {profile?.full_name && email && <small>{email}</small>}
          </div>
          <Link role="menuitem" to="/profile" onClick={() => setOpen(false)}><User size={16} aria-hidden="true" /> Profile</Link>
          <Link role="menuitem" to="/settings" onClick={() => setOpen(false)}><Settings size={16} aria-hidden="true" /> Settings</Link>
          <button type="button" role="menuitem" onClick={onSignOut}><LogOut size={16} aria-hidden="true" /> Sign out</button>
        </div>
      )}
    </div>
  );
}
