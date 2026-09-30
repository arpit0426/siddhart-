import React, { useCallback, useEffect, useState } from 'react';

/**
 * Minimal history-API router.
 *
 * Every page has a real URL (/customer/orders/abc123) so refreshes, deep links
 * and the browser back button behave correctly. The server serves index.html for
 * unknown non-API paths, which makes direct navigation work in production too.
 */

function currentPath(): string {
  return window.location.pathname + window.location.search;
}

const subscribers = new Set<() => void>();

export function navigate(to: string, options: { replace?: boolean; scroll?: boolean } = {}) {
  const [targetPath] = to.split('#');
  const next = to.startsWith('/') ? to : `/${to}`;
  if (targetPath === window.location.pathname && !to.includes('?')) {
    // Same page: only refresh the query string if it changed.
    if (next === currentPath()) return;
  }

  if (options.replace) {
    window.history.replaceState({}, '', next);
  } else {
    window.history.pushState({}, '', next);
  }

  subscribers.forEach((notify) => notify());

  if (options.scroll !== false && !next.includes('#')) {
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch {
      /* jsdom / older browsers */
    }
  }
}

export function useRoutePath(): string {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const notify = () => setPath(currentPath());
    subscribers.add(notify);
    window.addEventListener('popstate', notify);
    return () => {
      subscribers.delete(notify);
      window.removeEventListener('popstate', notify);
    };
  }, []);

  return path;
}

export function useQueryParams(): URLSearchParams {
  const path = useRoutePath();
  return new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?')) : '');
}

/** Matches "/customer/orders/:id" against a pathname, returning params or null. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const cleanPath = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const patternParts = pattern.replace(/\/+$/, '').split('/').filter(Boolean);
  const pathParts = cleanPath.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

interface LinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  children: React.ReactNode;
}

export const Link: React.FC<LinkProps> = ({ to, children, onClick, ...rest }) => {
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      navigate(to);
    },
    [onClick, to]
  );

  return (
    <a href={to} onClick={handleClick} {...rest}>
      {children}
    </a>
  );
};

export function useNavigate() {
  return navigate;
}
