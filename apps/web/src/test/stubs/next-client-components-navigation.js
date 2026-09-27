// Stub for next/dist/client/components/navigation.js
export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    refresh: () => {},
    prefetch: async () => {},
    back: () => {},
  };
}

export function usePathname() {
  return "/";
}

export function useSearchParams() {
  return new URLSearchParams();
}

export default {};

