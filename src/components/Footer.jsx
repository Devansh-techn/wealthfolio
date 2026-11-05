import { Link } from 'react-router-dom';
import './Footer.css';

const Footer = () => (
  <footer className="footer-section">
    <div className="container footer-content">
      <div className="footer-brand">
        <h3 className="heading-md">WealthFolio</h3>
        <p className="text-body text-sm mt-4 text-muted">A private, intelligent home for your wealth.</p>
      </div>
      <nav className="footer-links" aria-label="Footer">
        <div className="link-column">
          <h4>Platform</h4>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/screener">Screener</Link>
          <Link to="/analytics">Analytics</Link>
          <Link to="/watchlist">Watchlist</Link>
        </div>
        <div className="link-column">
          <h4>Account</h4>
          <Link to="/login">Log in</Link>
          <Link to="/signup">Sign up</Link>
          <Link to="/forgot-password">Reset password</Link>
        </div>
        <div className="link-column">
          <h4>Legal</h4>
          <Link to="/disclaimer">Financial disclaimer</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
        </div>
      </nav>
    </div>
    <div className="footer-bottom container">
      <p>&copy; {new Date().getFullYear()} WealthFolio. For information only — not investment advice. Market data may be delayed.</p>
    </div>
  </footer>
);

export default Footer;
