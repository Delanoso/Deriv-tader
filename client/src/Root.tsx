import { useEffect, useState } from "react";
import App from "./App";
import { CalculatorPage } from "./pages/CalculatorPage";

function pathOf(): string {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

export default function Root() {
  const [path, setPath] = useState(pathOf);

  useEffect(() => {
    const onPop = () => setPath(pathOf());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;
      if (anchor.target === "_blank" || event.metaKey || event.ctrlKey) return;
      event.preventDefault();
      if (url.pathname !== window.location.pathname) {
        window.history.pushState({}, "", url.pathname + url.search + url.hash);
        setPath(pathOf());
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  if (path === "/calculator") return <CalculatorPage />;
  return <App />;
}
