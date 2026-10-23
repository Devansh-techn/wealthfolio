import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    // Intentionally no user data in logs.
    console.error('UI error:', error?.message);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="auth-page">
        <div className="error-state glass-panel" role="alert">
          <h1 className="heading-md">Something went wrong</h1>
          <p>An unexpected error occurred. Your data is safe.</p>
          <button type="button" className="btn-primary-sm" onClick={() => window.location.assign('/')}>Reload WealthFolio</button>
        </div>
      </main>
    );
  }
}
