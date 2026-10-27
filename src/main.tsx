import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { geometryReady } from './workers/geometryClient';
import './fonts.css';
import './styles.css';
// Interactive maths (transforms, pick, brush) is synchronous Rust: the engine is ready before the first render.
void geometryReady().then(() => createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>));
