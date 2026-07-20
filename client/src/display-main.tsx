import ReactDOM from 'react-dom/client';
import { TvDisplayApp } from './display/TvDisplayApp';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');

ReactDOM.createRoot(rootElement).render(<TvDisplayApp />);
