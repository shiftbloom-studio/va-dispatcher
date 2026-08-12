const repositoryUrl = "https://github.com/shiftbloom-studio/va-dispatcher";

export function LegalNotice({ className = "" }: { className?: string }) {
  const configuredSourceUrl = process.env.NEXT_PUBLIC_SOURCE_URL?.trim();
  const sourceUrl = configuredSourceUrl || repositoryUrl;

  return (
    <p className={className}>
      <span>© 2026 VA Dispatch contributors</span>
      <span aria-hidden="true"> · </span>
      <a className="underline hover:no-underline" href={sourceUrl}>
        Source code
      </a>
      <span aria-hidden="true"> · </span>
      <a
        className="underline hover:no-underline"
        href={`${repositoryUrl}/blob/main/LICENSE`}
      >
        AGPL-3.0-or-later
      </a>
      <span aria-hidden="true"> · </span>
      <span>No warranty</span>
    </p>
  );
}
