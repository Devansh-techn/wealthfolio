import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Navbar.css';

const Navbar = () => {
  const { user, signOut } = useAuth();
  return (
    <nav className="navbar glass-panel" aria-label="Site">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo text-gradient">WealthFolio</Link>
        <div className="navbar-actions">
          {user ? (
            <>
              <Link to="/dashboard" className="btn-primary-sm">Dashboard</Link>
              <button type="button" className="btn-secondary" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn-secondary">Log in</Link>
              <Link to="/signup" className="btn-primary-sm">Get started</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
