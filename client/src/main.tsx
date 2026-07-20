import React from 'react';
import ReactDOM from 'react-dom/client';
import { ControlRoute } from './components/ControlRoute';
import { DisplayRoute } from './components/DisplayRoute';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const path = window.location.pathname.replace(/\/+$/, '') || '/';
const route = path === '/control'
  ? <ControlRoute />
  : path === '/display-legacy-auth'
    ? <DisplayRoute />
    : <DisplayRoute legacyRoot />;

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {route}
  </React.StrictMode>,
);
