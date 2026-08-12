# Security Policy

## Supported versions

VA Dispatch is currently developed before its first stable release. Security
fixes are applied to the latest commit on the default branch.

| Version                 | Supported |
| ----------------------- | --------- |
| `main`                  | Yes       |
| Older commits and forks | No        |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Email `hello@shiftbloom.studio` with the subject `[va-dispatcher security]`.
This is the project's current private reporting channel.

Include, when possible:

- the affected component, commit, and configuration;
- a clear description of the impact and attack scenario;
- minimal reproduction steps or a proof of concept;
- suggested mitigations, if known;
- whether the report or details have been shared elsewhere.

Never include real credentials, personal data, or destructive test payloads.
Use synthetic data and redact secrets from logs and screenshots.

Maintainers aim to acknowledge a report within five business days and provide
an initial assessment within ten business days. Resolution time depends on the
severity and complexity of the issue. Reporters will be kept informed of
material progress, and coordinated disclosure will be agreed before details are
published.

## Security automation

Pull requests are checked with a package advisory audit, dependency review, and
CodeQL. Dependabot monitors GitHub Actions. These checks support, but do not
replace, security-focused code review and responsible disclosure.
