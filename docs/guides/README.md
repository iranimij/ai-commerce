# Guides

One page per contract. Each example is real code in `modules/sample`, so CI runs it.

| Guide                                     | What it covers                                          |
| ----------------------------------------- | ------------------------------------------------------- |
| [Actions](actions.md)                     | The one way to change or read anything                  |
| [Modules and wraps](modules-and-wraps.md) | Packaging, dependencies, changing another module's work |
| [Events](events.md)                       | Telling other modules something happened                |
| [Pipelines](pipelines.md)                 | Letting other modules adjust a value, step by step      |
| [Services](services.md)                   | Replaceable implementations behind a name               |
| [Privacy classes](privacy.md)             | What may reach an AI model                              |
| [Resources and revisions](resources.md)   | Records with seven actions, history and restore         |
| [Attributes](attributes.md)               | Extra fields merchants and modules add to resources     |
| [Media](media.md)                         | Image uploads, re-encoded to WebP and served            |
| [Settings](settings.md)                   | Typed configuration, with encrypted secrets             |
| [Jobs](jobs.md)                           | Background work with retries                            |
| [Admin sign-in and roles](admin-auth.md)  | Sessions, mandatory 2FA, roles and escalation rules     |
| [HTTP API](http-api.md)                   | Calling actions over HTTP, OpenAPI, limits and headers  |
| [Design system](ui.md)                    | Tokens, themes, right-to-left and the React components  |
| [Translations](i18n.md)                   | Message catalogs, ICU, locales and right-to-left        |
| [Switching modules](module-switching.md)  | Installed versus enabled, presets, no-restart reloads   |
| [Installing a shop](installing.md)        | `npm create`, the image, the setup page and its token   |
| [The ai-commerce command](cli.md)         | dev, migrate, inspect, modules, add, backup and restore |
