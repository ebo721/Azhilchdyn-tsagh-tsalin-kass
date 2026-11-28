import type { AnchorHTMLAttributes } from 'react';
export function Link({ href: _href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href="#" onClick={event => { event.preventDefault(); onClick?.(event); }} />;
}
export const useLocation = () => ['/payroll'] as const;
export const useSearch = () => '';
