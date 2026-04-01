import { useState, useEffect } from "react";

// React Router v7 and certain Vite configurations can sometimes aggressively cache splat route updates.
// This native monkey-patch captures all programmatic navigations to guarantee our views always render.
const originalPush = window.history.pushState;
const originalReplace = window.history.replaceState;

window.history.pushState = function (...args) {
  originalPush.apply(window.history, args);
  window.dispatchEvent(new Event("local-nav-update"));
};

window.history.replaceState = function (...args) {
  originalReplace.apply(window.history, args);
  window.dispatchEvent(new Event("local-nav-update"));
};

export function usePathname() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleNav = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handleNav);
    window.addEventListener("local-nav-update", handleNav);
    
    return () => {
      window.removeEventListener("popstate", handleNav);
      window.removeEventListener("local-nav-update", handleNav);
    };
  }, []);

  return path;
}
