# Security policy

## Reporting a problem

Please report security problems privately through
[GitHub security advisories](https://github.com/iranimij/ai-commerce/security/advisories/new).
Do not open a public issue, pull request or discussion for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it.

## What to expect

- An acknowledgement within 3 working days.
- An assessment and a plan within 10 working days.
- Credit in the release notes when the fix ships, unless you prefer to stay anonymous.

## Supported versions

AI Commerce has not had a release yet. Until version 1.0, only the `main` branch receives
security fixes.

## Scope

Of particular interest:

- Any way to read or change shop data without going through an action's permission check.
- Any way for the AI assistant to do more than the admin it acts for, to get past a lock, or to
  receive data classed as secret.
- Any way for text written by a customer to make the AI take an action.
- Takeover of an install that has not finished setup.
