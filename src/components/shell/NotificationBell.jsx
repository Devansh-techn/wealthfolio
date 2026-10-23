import { Bell, X } from 'lucide-react';
import { useAppData } from '../../contexts/DataContext';
import { useToast } from '../../contexts/ToastContext';
import { markNotificationsRead, deleteNotification } from '../../services/dataService';
import { friendlyError } from '../../lib/validation';
import { formatRelativeTime } from '../../lib/format';
import { usePopover } from './usePopover';

export default function NotificationBell() {
  const { notifications, refresh } = useAppData();
  const toast = useToast();
  const { open, setOpen, ref } = usePopover();
  const unread = notifications.filter((n) => !n.is_read);
  const markAll = async () => {
    try {
      await markNotificationsRead(unread.map((n) => n.id));
      await refresh(['notifications']);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };
  const remove = async (id) => {
    try {
      await deleteNotification(id);
      await refresh(['notifications']);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };
  return (
    <div className="popover-wrap" ref={ref}>
      <button type="button" className="icon-btn" aria-label={`Notifications${unread.length ? `, ${unread.length} unread` : ''}`} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        <Bell size={19} strokeWidth={1.6} />
        {unread.length > 0 && <span className="badge-dot">{unread.length > 9 ? '9+' : unread.length}</span>}
      </button>
      {open && (
        <div className="popover glass-panel" role="region" aria-label="Notifications">
          <div className="popover-head">
            <strong>Notifications</strong>
            {unread.length > 0 && <button type="button" className="link-sm" onClick={markAll}>Mark all read</button>}
          </div>
          {notifications.length === 0 ? (
            <p className="text-body popover-empty">You're all caught up.</p>
          ) : (
            <ul className="notif-list">
              {notifications.slice(0, 12).map((n) => (
                <li key={n.id} className={n.is_read ? '' : 'unread'}>
                  <div>
                    <strong>{n.title}</strong>
                    {n.body && <p>{n.body}</p>}
                    <small>{formatRelativeTime(n.created_at)}</small>
                  </div>
                  <button type="button" className="icon-btn" aria-label={`Dismiss ${n.title}`} onClick={() => remove(n.id)}><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
