import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui/Feedback';

export default function NotFound() {
  return (
    <main className="auth-page">
      <EmptyState icon={Compass} title="Page not found" text="The page you are looking for doesn't exist or has moved." action={<Link className="btn-secondary" to="/">Go home</Link>} />
    </main>
  );
}
