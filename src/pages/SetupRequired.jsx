import { Link } from 'react-router-dom';
import { Database } from 'lucide-react';
import { EmptyState } from '../components/ui/Feedback';

export default function SetupRequired() {
  return (
    <main className="auth-page">
      <EmptyState
        icon={Database}
        title="Backend setup required"
        text="Supabase is not configured. Copy .env.example to .env, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server. See the README for the full setup."
        action={<Link className="btn-secondary" to="/">Back to home</Link>}
      />
    </main>
  );
}
