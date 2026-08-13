export function getTenantAuthRoutes(slug: string) {
  const home = `/${slug}`;
  const signIn = `${home}/sign-in`;
  const tasks = `${home}/tasks`;

  return {
    home,
    join: `${home}/join`,
    signIn,
    signUp: `${home}/sign-up`,
    taskUrls: {
      "choose-organization": `${tasks}/choose-organization`,
      "reset-password": `${tasks}/reset-password`,
      "setup-mfa": `${tasks}/setup-mfa`,
    },
  } as const;
}
