// Minimal stub for next/headers used in server-side code paths during tests
export async function cookies() {
  return {
    get: (_name: string): { value?: string } | undefined => undefined,
  };
}

