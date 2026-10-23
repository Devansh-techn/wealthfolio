import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
// Shared UI primitives (buttons, inputs, notices, toasts, loaders, legal/404) and the auth shell are needed by PUBLIC
// routes too, so they load globally here. They used to be imported only by the lazy AppLayout, which left /login,
// /signup, toasts, loaders and error pages unstyled until a protected page had been visited.
import './styles/app.css';
import './styles/auth.css';
import './styles/dashboard.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
