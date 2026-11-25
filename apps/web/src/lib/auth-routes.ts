export function getTenantAuthRoutes(slug: string) {
  const home = `/${slug}`;

  return {
    home,
    join: `${home}/join`,
    signIn: `${home}/sign-in`,
    signUp: `${home}/sign-up`,
  } as const;
}
