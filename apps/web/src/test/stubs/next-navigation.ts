// Minimal stubs for Next.js navigation used in tests
export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    prefetch: async () => {},
    back: () => {},
    refresh: () => {},
  };
}

export function useSearchParams() {
  if (typeof window !== "undefined") {
    return new URLSearchParams(window.location.search);
  }
  return new URLSearchParams();
}

export function usePathname() {
  if (typeof window !== "undefined") {
    return window.location.pathname || "/";
  }
  return "/";
}

export function notFound(): never {
  throw new Error("notFound()");
}

export function redirect(url: string): never {
  const error = new Error(`redirect(${url})`);
  // Attach a flag to help tests detect redirect if needed
  // @ts-expect-error nonstandard test flag
  error.__isRedirect = true;
  throw error;
}

