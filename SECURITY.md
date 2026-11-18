# Security Policy

## Running Compiled Programs

`onde` is a compiler, not a sandbox. Compiling source does not make it safe to
run: generated programs execute with the operating-system permissions of the
process that launches them. Do not run untrusted generated binaries as root or
with elevated capabilities. The current `fs` plugin rejects setuid, setgid, and
sticky mode bits, but that is not a substitute for OS-level isolation.

The native backend is experimental and does not yet guarantee memory-safe
behavior for every accepted TypeScript program. Use an unprivileged account and
an OS sandbox/container when evaluating untrusted input.

## Reporting Security Issues

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in `onde`, please report it responsibly:

- Use GitHub's **Private Vulnerability Reporting** feature on the [onde repository](https://github.com/bolawijen/onde/security/advisories/new).
- Alternatively, reach out directly to the maintainers through their GitHub profile or listed contact.

Please include:
- A description of the vulnerability.
- Steps to reproduce or proof-of-concept.
- The impact and affected configurations.

We will acknowledge your report promptly, investigate the issue, and coordinate a fix and advisory.

## Upstream Security Issues

Because `onde` is derived from TypeScript components, if you discover an issue originating within upstream TypeScript code that affects Microsoft products or the general TypeScript ecosystem, consider coordinating with the upstream [Microsoft Security Response Center](https://msrc.microsoft.com/).
