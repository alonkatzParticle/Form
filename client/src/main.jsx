import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import axios from 'axios'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'

// Inject per-user Monday API key into every /api/monday request.
// The key is stored in localStorage so it persists across refreshes and server restarts.
axios.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem("user_monday_api_key");
  if (apiKey && config.url?.includes("/api/monday")) {
    config.headers["X-Monday-Api-Key"] = apiKey;
  }
  return config;
});

const router = createBrowserRouter([
  {
    path: "*",
    element: <App />
  }
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
