# AI Commerce: design

## 1. Context

Iman wants an open-source e-commerce platform that can replace Magento, Shopify and Shopware.

- **Breadth**: every feature of Magento Open Source 2.4.9 and Adobe Commerce.
- **Flexibility**: third parties build modules, themes and language packs, as freely as on Magento.
- **Simplicity**: a modern TypeScript stack with a structure a developer learns in days.
- **AI-native**: the admin is a chat that answers with downloadable pages (HTML, PDF, CSV); content
  is edited inline on the storefront; Gemini, Claude and ChatGPT are interchangeable (Gemini
  first). It is for merchants who trust AI to do the work, and it teaches them as it goes.
- **Any size**: from a tiny shop with almost no features to a Magento-scale install, chosen at
  installation in the browser and changeable later.
- **Easy to move to**: importers for Magento, Shopify and Shopware.
- **Quality**: professional, accessible UI; security in the core; unit, integration and end-to-end
  tests everywhere; a real QA pass on every milestone; everything documented well in Notion.

## 2. Product principles

These settle any detail the plan does not spell out.

1. **One definition, every surface.** A feature is declared once and appears in the API, the chat,
   MCP, the classic admin and the audit log.
2. **Nothing hidden.** No generated classes, no merged XML, no interception of arbitrary methods.
   `ai-commerce inspect` can always answer "why did this happen".
3. **Core has no privileges.** First-party modules use the same public contracts as third-party
   ones. If core needs a back door, the contract is fixed instead.
4. **Off means absent.** A disabled module adds no menu, setting, route, query or storefront code.
5. **The AI acts as the admin, never above them.** Same permissions, confirmation before anything
   destructive, everything logged.
6. **Works without AI.** No key configured, provider down, or an admin who prefers not to use
   it: the dashboard manages the whole shop.
7. **Secure and accessible by default.** A module author gets validation, permission checks,
   audit, CSRF protection and accessible components without asking.
8. **A milestone is done only when it is tested, QA'd and documented.**

## 3. Decisions (mine unless marked; approving this plan approves them)

1. **Own TypeScript core**, not built on Medusa. The action registry must be the core.
2. **Name: AI Commerce** (Iman). Folder `~/Projects/ai-commerce`, CLI `ai-commerce`.
3. **MIT licence.**
4. **Stack**: pnpm monorepo with Turborepo, Node LTS, PostgreSQL + Drizzle (also search, jobs and
   cache at first), Hono + Zod, Next.js + React, Tailwind + Radix with our own tokens, Vercel AI
   SDK, Better Auth, Vitest, Playwright.
5. **Channels** replace Magento's website, store and store view.
6. **Size is a dial** (Iman). Presets are named lists of modules: `minimal` (catalog with a
   contact or buy link, no cart), `starter` (cart, checkout, orders, customers, pages, one
   payment, one shipping method), `standard`, `full`. Switching a module off keeps its data.
7. **Dashboard and chat, both first-class** (Iman, 2026-11-15). See 3b.
8. **Browser installer** (Iman), detailed in M0.
9. **Module switching.** All first-party modules ship in the install, so enabling one is a flag
   plus its migrations. Third-party modules are added with `ai-commerce add <package>` on the
   server, never from a web page, because installing code from the browser is a
   remote-code-execution risk.
10. **Migration is a first-class feature** (Iman), its own early milestone (M3), extended by
    every later milestone.
11. **Full checkout** (Iman) in M2.
12. **QA gate on every milestone** (Iman).
13. **Stripe is the first online payment**, PayPal second. Both cover Europe and most markets.
14. **Self-hosted first.** We ship a Docker image and a Compose file. A hosted service is not
    planned.
15. **Any scale** (Iman): the same platform for a very small shop and a very large one. See 5.7.
16. **Public GitHub repository** (Iman): `iranimij/ai-commerce`, public from the first commit.
    Commits and pull requests carry no Claude or Anthropic attribution of any kind.

17. **Pull request per section, merged by me** (Iman). Every section of work goes on its own
    branch and pull request. I merge it myself, without asking, once CI is green; I never merge a
    red one. `main` is protected: no direct pushes, CI required.
18. **Standard open-source repository setup** (Iman), built in M0:
    - CI on every pull request: lint (ESLint), formatting (Prettier), type check, unit tests,
      integration tests against PostgreSQL, end-to-end tests, accessibility checks, build.
      ESLint and Prettier are the TypeScript counterpart of PHP CS.
    - Security: CodeQL, dependency audit, secret scanning, Dependabot updates.
    - Releases: Changesets for versions and changelogs, a release workflow that publishes the
      npm packages and the Docker image from a tag.
    - Conventional commit messages, checked in CI.
    - `README`, `CONTRIBUTING`, `SECURITY`, code of conduct, pull request and issue templates,
      `CODEOWNERS`.

Answered by Iman on 2026-11-15:

- **Name stays AI Commerce.** The npm names `ai-commerce` and `create-ai-commerce` are taken, so
  packages go under the `@aicommerce` scope (`@aicommerce/core`) and the install command is
  `npm create @aicommerce`. The scope is registered at the start of M0; if it is also taken I come
  back with alternatives.
- **Fully free under MIT**, including the Adobe Commerce level features.
- **First market: global and Europe.** English first, Stripe and PayPal, EU tax and privacy rules.
- ~~AI for the admin now; a shopper assistant later~~ Replaced on 2026-11-15: Iman wants a
  customer chatbot. It is built in M2. See 3f.

19. **Docker only** (Iman, 2026-11-15). Development, tests and local running happen entirely in
    containers defined by one Compose file: the Node app, PostgreSQL, a mail catcher, and the
    Playwright runner. Nothing is installed or run on the host except Docker, git and `gh`.
    Every command is run as `docker compose run` or `exec`. Iman's Chrome is used for manual QA
    against the containers.

## 3a. Beyond Magento: ideas that make it more than a copy

My proposals. Each is cheap because it falls out of the architecture, and each is placed in a
milestone.

| Idea                  | What the merchant gets                                                                                                  | Why it is cheap                                       | Milestone |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------- |
| Explain this number   | Click any price, tax or total and see each step that produced it                                                        | Pipelines already run as named steps                  | M2        |
| Undo anything         | A history on every product, page, order and setting, with one-click restore                                             | Revisions are in the core                             | M1        |
| Preview before apply  | Bulk changes by chat ("raise all shoe prices 5%") show a before and after table first                                   | Actions can run in a rolled-back transaction          | M1        |
| Automations by chat   | "When stock drops under 5, email me" becomes a saved rule                                                               | A rule is an event plus an action, both already typed | M9        |
| Morning brief         | A daily page: yesterday's sales, what needs attention, suggested actions                                                | A scheduled chat prompt producing an artifact         | M9        |
| Shop health check     | The AI audits missing images, weak SEO text, broken links, accessibility, slow pages, and offers fixes                  | Read actions plus existing checks                     | M4        |
| Talk to your shop     | Voice input in the admin chat, on desktop and phone                                                                     | Browser speech recognition                            | M1        |
| Command palette       | One shortcut to search, jump or run any action                                                                          | The registry lists every action                       | M1        |
| Ready for AI shoppers | Product data published in the formats AI shopping agents read, and a safe public MCP endpoint for browsing and ordering | Same registry, guest actor                            | M10       |
| Teach me              | Every chat answer can show how to do it by hand and why it matters                                                      | Action descriptions already exist                     | M1        |

## 3b. The admin: dashboard and chat together, and how trust is earned

Iman's concern: merchants may not trust a chatbot with their shop. So the chat never replaces the
dashboard; the two are one admin.

- **A full dashboard, laid out like Magento's** (Iman): the same top-level groups (Sales, Catalog,
  Customers, Marketing, Content, Reports, Stores, System) and a screen for every feature, so a
  Magento admin feels at home, but cleaner and faster. Screens are generated from resources, with hand-built screens for
  complex editors. It is a first-class surface, designed and tested like the storefront.
- **A chat bar at the top of every screen.** It searches, answers, runs actions, and opens
  screens. It doubles as the command palette. It can expand into a full-page conversation.
- **Each admin chooses their home**: dashboard-first or chat-first. Small-shop presets default to
  chat-first; the dashboard is one click away, never hidden.
- **Do it or show it.** For any request the chat can make the change, or open the right screen
  with the fields filled in so the admin presses save. Forms accept pre-filled values from the
  chat because both are built from the same action schema.

Trust is a setting per admin, with three levels:

| Level         | What the AI may do                                                            |
| ------------- | ----------------------------------------------------------------------------- |
| Guide         | Answer questions and open the right screen pre-filled. The admin presses save |
| Ask (default) | Make changes, with a confirm card for each one first                          |
| Auto          | Make ordinary changes without asking. Destructive actions still ask, always   |

A shop owner can cap the level for other admins. The AI can never exceed the admin's own
permissions at any level.

What lets an admin verify the AI:

- Every answer links to the screen and records it came from, so any number can be checked.
- "Show your work": each reply can expand to the exact actions called and their inputs.
- Bulk changes show a before and after table before anything is applied.
- Every change has undo.
- The activity log marks each entry as done by the admin or by the AI on that admin's behalf.

## 3c. AI duties: standing rules the admin gives the AI

Iman, 2026-11-15: admins should be able to hand the AI the work that is not crucial or urgent,
by writing simple rules.

A duty is a standing instruction written in plain words, for example:

- "Approve reviews that are polite and on-topic. Hold the rest for me."
- "Three days after delivery, email the customer asking for a review."
- "Every Monday at 8, email me last week's sales report."
- "When a product drops under 5 in stock, tell me and draft a reorder list."

The chat turns the sentence into a duty the admin reviews before switching it on:

| Part            | Meaning                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Trigger         | An event (`review.created`, `order.delivered`) or a schedule                                      |
| Instruction     | The admin's words, which the model follows on each run                                            |
| Allowed actions | A short explicit list (`review.approve`, `review.hold`, `email.send`). Nothing else can be called |
| Limits          | Maximum runs per day, maximum emails per customer, spending cap on AI usage                       |

Safety rules:

- A duty runs as "AI on behalf of the admin who created it" and can never exceed that admin's
  permissions.
- `destructive` actions (refund, delete, price and stock changes in bulk) cannot be put in a duty.
- A duty can be tried first in "dry run", where it only reports what it would have done.
- Every run is in the activity log with its reasoning. Each change has undo.
- A daily digest lists what the duties did. One switch pauses a duty or all of them.

The engine arrives in M2 (events, schedules and email exist by then). Each later module adds the
duties that make sense for it; review moderation and review requests come with reviews in M8.
This replaces "Automations by chat" and "Morning brief" in section 3a, which are now duties.

## 3d. AI features built into the shop

Proposals, each placed where its data first exists. All are modules that can be off, all work
through the same provider setting, and each has a non-AI fallback.

| Feature                                | What it does                                                                                               | Fallback without AI          | Milestone                          |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------- |
| Related products, upsells, cross-sells | Picks the best matches from product meaning and from what is bought together; the admin can pin or exclude | Hand-picked or same-category | M1, improved with order data in M2 |
| Search that understands meaning        | "warm jacket for rain" finds waterproof coats                                                              | Keyword search               | M1                                 |
| Product and SEO text                   | Drafts titles, descriptions, meta text in the shop's tone                                                  | Empty fields                 | M1                                 |
| Image descriptions                     | Alt text for every image, for accessibility and SEO                                                        | Empty                        | M1                                 |
| Customer message drafts                | Suggested replies to order questions for the admin to send                                                 | None                         | M2                                 |
| Order risk hint                        | Flags unusual orders for review; never blocks on its own                                                   | None                         | M2                                 |
| Translations                           | Catalog and content into a new language as drafts                                                          | Manual                       | M6                                 |
| Stock forecast                         | Predicts when a product runs out                                                                           | Low-stock threshold          | M7                                 |
| Review summary and moderation          | "What buyers say" on the product page; spam and abuse held                                                 | Manual moderation            | M8                                 |
| Smart segments and recommendations     | Customer groups and personal recommendations                                                               | Rule-based                   | M11                                |

Meaning-based features use vector search inside PostgreSQL (pgvector), so no new service is
needed.

## 3e. Models: one main model and specialised ones

> **Status (Iman, 2026-11-15, later the same day): own models and local models are postponed.**
>
> - AI Commerce uses hosted LLMs only: Gemini, Claude and OpenAI. The admin chooses the provider
>   in the settings, or turns AI off.
> - Creating our own models (X1 to X3 below) is a big decision. It is reconsidered no sooner than
>   one year after AI Commerce is in real use.
> - Running open models locally is postponed with it, and so are the Private and Hybrid AI modes.
>   The modes for now are **Hosted** and **Off**.
> - Consequences elsewhere: in 3f only option A is built; in 3g the "to a local model" column and
>   network-enforced Private mode do not apply yet.
> - What stays: model roles (so a shop can use a cheaper model for moderation and a stronger one
>   for the chat, from the same or different providers), and the whole privacy design in 3g.
>
> The sections below are kept as the record of the idea, not as scheduled work.

Iman, 2026-11-15: one model for the whole shop, and separate models for individual features.

Every AI task names a **role**, and settings map each role to a provider and model:

| Role         | Used for                                                | Sensible default                      |
| ------------ | ------------------------------------------------------- | ------------------------------------- |
| `assistant`  | The admin chat, duties, anything that calls actions     | The strongest model configured        |
| `writing`    | Product text, SEO text, translations, message drafts    | Same as assistant                     |
| `moderation` | Reviews and comments: spam, abuse, sentiment            | A small fast model                    |
| `embedding`  | Related products, meaning-based search, recommendations | An embedding model                    |
| `vision`     | Image descriptions                                      | A model that reads images             |
| `forecast`   | Stock forecast, order risk                              | A small model, or plain statistics    |
| `shopper`    | The customer chatbot on the storefront                  | Same as assistant, or a cheaper model |

- A shop that sets only one model uses it for every role. Overriding a role is one setting.
- A module can define a new role for its own feature.
- A provider is anything with a compatible API: Gemini, Claude, OpenAI, a model running locally,
  or a model trained by us. So AI Commerce's own fine-tuned models (for example a review
  moderator or a related-products ranker) plug in as providers when they exist, with no change to
  the features that use the role.
- Usage and cost are recorded per role, with a monthly cap per role.

### Open models running locally

Iman, 2026-11-15: use well-known open-source models from Hugging Face for work that can be done
on the shop's own server.

- An optional `models` container in the Compose file serves open models through the same API
  shape as the hosted providers, so a role is pointed at it with one setting.
- Good fits: `moderation`, `embedding`, `vision`, `forecast`. No API cost, and customer data
  never leaves the server.
- The `assistant` role still needs a strong model. Small local models are not reliable at
  choosing and calling actions, and a wrong action is worse than a slow one.
- **AI mode** is a named choice in the installer and the settings (Iman, 2026-11-15: merchants
  will value their data never leaving their server):

  | Mode             | Where data goes                                                                             | Trade-off                                                                                    |
  | ---------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
  | Private          | Nowhere. Every role runs on the shop's server                                               | The chats are less capable unless the server has a strong GPU. X3 is meant to close that gap |
  | Hybrid (default) | Only the `assistant` and `shopper` chats use a hosted provider; everything else stays local | Best balance today                                                                           |
  | Hosted           | A provider handles every role                                                               | Easiest, no GPU needed                                                                       |
  | Off              | No AI                                                                                       | Dashboard only                                                                               |

  The mode can be changed at any time. Every AI feature shows which model runs it and whether it
  is local or hosted.

- Arrives in M1 with the first roles that can use it (embedding, vision).

### Our own models, published as AI Commerce on Hugging Face

Iman, 2026-11-15: AI Commerce should have its own models, published under the brand so other
shops and developers can use them too.

A separate model track that runs beside the milestones:

| #   | Model                      | What it does                                                                                                                                                                                                | Trained on                                                               | When                                           |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| X1  | Product matcher (flagship) | Finds the best related products for a customer, in two steps: find candidates by meaning, then rank them against the cart, browsing, what is bought together, price range and stock, with a reason for each | Public product, query and co-purchase data with a licence that allows it | After M2                                       |
| X2  | Review moderator           | Spam, abuse and sentiment for product reviews                                                                                                                                                               | Public review data plus labelled examples                                | After M8                                       |
| X3  | Commerce assistant         | A small model tuned to call shop actions, for running the admin chat and the shopper assistant locally                                                                                                      | Recorded and synthetic chat-to-action examples                           | After M11, only if X1 and X2 proved worthwhile |

Rules for every model:

- It starts from an open model with a licence that allows fine-tuning and redistribution.
- Training data licences are checked and listed on the model card.
- It is published only if it beats the open model it replaces on a written, repeatable test.
  The test and the numbers go on the model card.
- It plugs in as a provider for its role. No feature depends on it.

Limits, stated plainly: training needs rented GPU time, which costs money, and a general chat
model that rivals Gemini or Claude is out of reach and not planned. Small specialised models are
realistic.

## 3f. The shopper assistant: a chatbot for customers

Iman, 2026-11-15: customers must be able to chat with the shop, and it should be smart.

Options considered:

|                      | A. Hosted model with shop tools | B. Open model on the shop's server                        | C. Our own commerce model        |
| -------------------- | ------------------------------- | --------------------------------------------------------- | -------------------------------- |
| How smart            | Very, from day one              | Good for questions and search, weaker at multi-step tasks | Unknown until trained and tested |
| Cost to the merchant | Per conversation                | A server with a GPU, no per-message fee                   | Same as B                        |
| Customer data        | Goes to the provider            | Stays on the server                                       | Stays on the server              |
| When                 | M2                              | M2, as a setting                                          | Model track X3                   |

**Chosen: A first, built so B and C are a setting** (my recommendation; Iman asked for options).
The chatbot has its own model role, `shopper`.

What it does, all through existing actions as the guest or logged-in customer:

- Find and compare products, with suggestions from the product matcher.
- Answer from the shop's own pages and policies (shipping, returns, sizes).
- Check stock, add to cart, apply an existing coupon.
- Show the customer their own orders and start a return.

What keeps a public chatbot safe:

- It acts as the visitor: it can do only what that visitor could do by clicking, and never sees
  another customer's data.
- It cannot invent discounts, change prices or promise anything outside shop policy.
- It answers only from shop data and says so when it does not know.
- Rate limits per visitor, an abuse filter, and a monthly cost cap per shop. When the cap is hit
  the widget turns into a contact form.
- It is labelled as an AI, hands over to a human by email on request, and the admin can read
  every conversation.
- It is a module: off by default in `minimal`, a tick in the installer.

## 3g. Privacy: what the AI can see, do and send

Iman, 2026-11-15: many well-known shops do not want an AI working with all of their data.
Merchants must be able to verify that their data stays with them, to lock things away from the
AI, and to see everything the AI did and sent.

### Results go to the admin, not to the model

The model plans; the server executes; the result is rendered directly to the admin.

1. The admin asks "what are today's orders?".
2. The model answers with an action call (`order.list` with a date filter) and a layout.
3. The server runs the action as the admin and sends the rows to the admin's browser.
4. The model receives only a **digest**: row count, column names and, where the action declares
   them, aggregates such as the total. It receives row contents only when the next step needs
   them and the privacy class allows it.

Every answer has "show the query": the action, its exact input, and what the model received back.

### Privacy class on every field

Each field in a schema carries a class. One function in the core, the AI boundary, is the only
place data is prepared for a model, and it enforces the classes.

| Class      | Examples                                              | To a hosted model                                                                                                          | To a local model |
| ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `public`   | Product names, prices, page text                      | Yes                                                                                                                        | Yes              |
| `internal` | Order totals, stock, sales figures                    | Digests by default; the owner can allow rows                                                                               | Yes              |
| `personal` | Names, emails, addresses, phone numbers, IP addresses | No. Replaced by a stable stand-in ("Customer 1042") and restored when shown to the admin. The owner can allow named fields | Yes              |
| `secret`   | Passwords, API keys, tokens, payment details          | Never                                                                                                                      | Never            |

- A field with no class is treated as `personal`, so a module author who forgets is safe.
- `secret` has no setting. It cannot be allowed.
- Free text written by customers (reviews, order notes) is `personal` and also marked as
  untrusted input (5.1).

### AI locks

The shop owner can lock any action, module or field from the AI.

- A locked action is not offered as a tool, so the model does not know it exists. A locked field
  is removed at the AI boundary.
- Locks apply to the admin chat, duties, the shopper assistant and the MCP endpoint alike.
- Locked by default: payment and tax settings, admin users, roles and permissions, API tokens,
  AI settings and the locks themselves, module install and removal, data export of customers.
- Only an owner can change locks, from the dashboard, with 2FA. The AI can never change a lock,
  its own trust level, or its own permissions.

### The "what left my server" log

Separate from the activity log (what the AI did), the outbound log records what was sent.

| Recorded per request                                                |     |
| ------------------------------------------------------------------- | --- |
| When, and which admin, duty or visitor it was for                   |     |
| Role, provider, model, and whether it was local or hosted           |     |
| The exact content sent, viewable in full                            |     |
| Which privacy classes it contained and how many stand-ins were used |     |
| Size and cost                                                       |     |

The owner can filter it, export it, and set how long it is kept. In Private mode the page states
that no request left the server, and the app container can be run with outbound network access
to model providers blocked, so the claim is enforced by the network and not only by our code.

### Retention at the provider

- Hosted requests are sent with the provider's no-retention and no-training options wherever the
  provider offers them. Settings show the status per provider.
- We cannot verify what a provider does on its side, and the product says so. Merchants who need
  certainty use Private mode.
- Our own stored copies (conversations, outbound log) have an owner-set retention period and are
  included in customer data export and deletion.

### Where this is built

| Piece                                                           | Milestone |
| --------------------------------------------------------------- | --------- |
| Privacy class on fields, the AI boundary, default-personal rule | M0b       |
| Digests, stand-ins, "show the query", outbound log, locks       | M1        |
| Network-enforced Private mode                                   | M1        |
| Applied to duties and the shopper assistant                     | M2        |

## 4. Architecture

### 4.1 Repository

```
ai-commerce/
  apps/
    storefront/    Next.js shop
    admin/         Next.js admin: chat, classic screens, setup page
    server/        Hono: public API, MCP endpoint, background jobs
  packages/
    core/          modules, actions, resources, events, pipelines, settings, actors, audit, revisions
    db/            Drizzle, migrations
    ui/            design system
    i18n/          translation layer
    ai/            provider adapter, chat loop, artifacts
    migrate/       import engine and source connectors
    cli/           ai-commerce dev | migrate | inspect | add | module create | import
    create/        the installer behind `npm create @aicommerce`
  modules/         catalog, cart, checkout, sales, customer, ... one folder each
  themes/default/
  docs/
```

### 4.2 Contracts a module uses

| Contract         | Purpose                                                                                     | Replaces in Magento                                       |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `defineModule`   | Name, dependencies, everything below                                                        | module.xml, registration.php                              |
| `defineAction`   | One operation: input, output, permission, risk, handler                                     | Service contracts, webapi.xml, acl.xml, GraphQL resolvers |
| `defineResource` | Groups list, get, create, update, delete around an entity; drives generated screens         | UI component XML, grids, forms                            |
| Events           | Typed notifications after something happened                                                | Observers                                                 |
| Pipelines        | Named, ordered extension points (`price.calculate`, `cart.totals`, `checkout.validate`)     | Plugins                                                   |
| Attributes       | Extra typed fields on any entity, created by modules or by merchants at runtime, filterable | EAV, extension attributes                                 |
| Settings         | Typed configuration, global then channel                                                    | system.xml, core_config_data                              |
| Slots            | Named places in storefront and admin where a module puts or replaces UI                     | Layout XML, blocks                                        |
| Schema           | The module's own tables and migrations                                                      | db_schema.xml, patches                                    |

### 4.2a Overriding core behaviour without editing core

Iman, 2026-11-15: developers must be able to change core behaviour as freely as with Magento's
plugins, events and overrides, and updates must not break because of it.

| Need                                                                 | Contract                                                                                       | Magento equivalent             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| Run code before, after or instead of any action                      | `wraps`: a function around the action's handler, `(input, ctx, next) => output`, with an order | Plugin (before, after, around) |
| Swap a core service, such as the tax calculator or the URL generator | Services are named interfaces; a module `provides` a replacement                               | Preference                     |
| React to something that happened                                     | Event subscriber                                                                               | Observer                       |
| Change one step of a calculation                                     | Add a pipeline step, or replace a named step                                                   | Plugin on a calculation method |
| Replace part of a page or admin screen                               | Replace a slot component or a theme template                                                   | Layout XML, template override  |
| Add or change fields                                                 | Attributes                                                                                     | Extension attributes           |

Rules that keep updates safe:

- Nobody edits core files. Every override lives in the developer's own module.
- Only declared things can be overridden: actions, services, pipeline steps, slots, templates.
  Arbitrary internal functions cannot, which is what lets core change its internals freely.
- Wraps run inside the call path, after input validation and the permission check and before
  output validation, so an override cannot bypass security or return malformed data.
- `inspect` lists every wrap, replacement and step for a name, with module and order.
- Each overridable contract has a version. `upgrade` reports every override whose target
  changed, before anything is applied.
- Two modules replacing the same service is a startup error naming both, unless one declares
  that it depends on the other.

### 4.3 How a call runs

Every call, from any source, goes through one path: identify the actor, validate input, check
permission and ownership, apply the confirm gate, run the handler in a transaction, save a
revision, write the audit entry, emit events.

Actors: guest, customer, admin, API token, system job. Storefront reads and customer writes are
actions too.

### 4.4 Answers to the reviewer's gaps

| Gap                               | Answer                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Drafts and undo                   | A revision snapshot on every resource write. Undo restores a revision. Inline edits save directly; scheduled changes (M11) build on revisions |
| Channel, locale, currency         | Schemas are channel-aware, translatable and multi-currency from M1. Managing more than one arrives in M6 with no rewrite                      |
| Stock before the inventory module | One quantity per product behind the inventory interface                                                                                       |
| Destructive actions with no click | MCP uses a two-step confirm token. API tokens are trusted within their explicit scope                                                         |
| Artifacts                         | The model returns data plus a layout chosen from our components (table, stat, chart, document). It never writes HTML                          |
| One deployable                    | Storefront and admin call actions in-process. One container can run everything                                                                |
| What parity means                 | Feature for feature by M11. A milestone may be split over several chats                                                                       |

## 5. Standards that apply to every milestone

### 5.1 Security

- No path to data except through an action.
- Admin: 2FA or passkey mandatory, session expiry, login rate limit, optional IP allow-list.
- Storefront: CSRF protection, strict Content Security Policy, rate limits, captcha hook.
- Card data never reaches our server; payment modules use the provider's hosted fields.
- Secrets encrypted at rest. Append-only audit log of every admin, API and AI action.
- AI: no credentials, no database access. Customer-written text is passed as marked data; while
  it is in context, `write` actions need confirmation as well as `destructive` ones.
- File uploads: type and size checked, stored outside the web root, images re-encoded.
- CI: dependency audit, secret scan, static analysis. A threat-model note per milestone.

### 5.2 Testing

| Level       | Tool                     | Covers                                                                                                        |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Unit        | Vitest                   | Handlers, pipeline steps, pure logic                                                                          |
| Integration | Vitest + real PostgreSQL | Every action through the registry: success, permission denied, invalid input                                  |
| End-to-end  | Playwright               | Every user flow the milestone delivers, desktop and mobile, with recorded AI responses so runs are repeatable |

Also: accessibility checks in end-to-end runs, and a contract test proving the sample third-party
module still works after every core change.

### 5.3 QA gate

After automated tests are green I act as the tester:

1. Write the test plan for the milestone in Notion.
2. Walk every flow in a real browser at desktop and mobile widths, in light, dark and
   right-to-left.
3. Try bad input, missing permissions, double submits, back button, slow network, provider down.
4. Log each bug, fix it, add a test that would have caught it, retest.
5. File the report in Notion. Open bugs block the milestone.

### 5.4 Documentation

- Notion is the working record (section 8), updated at the end of every milestone.
- `docs/` in the repo holds developer documentation that ships with the code; it becomes the
  public docs site in M12.
- Every contract in 4.2 has a guide with a runnable example before its milestone closes.
- `PROGRESS.md` in the repo records where the build stands for the next chat.

### 5.5 Design

- One design system for storefront and admin: tokens, light and dark, right-to-left, 360px up.
- WCAG 2.2 AA. Keyboard and screen-reader tested.
- Every screen has designed empty, loading and error states.
- Performance budget for the storefront: Lighthouse 95+ on the default theme.

### 5.6 Other standards

- **Languages**: every string goes through the translation layer from M0.
- **Privacy**: customer data export and deletion, cookie consent, data retention settings (M2).
- **Upgrades**: semantic versioning of the module contracts; `ai-commerce upgrade` runs
  migrations and reports modules that use removed contracts.
- **Operations**: structured logs, health endpoint, backup and restore commands (M0).

### 5.7 Scale

The small shop and the very large shop run the same code; only the deployment differs.

|                    | Small shop                          | Very large shop                                                            |
| ------------------ | ----------------------------------- | -------------------------------------------------------------------------- |
| Processes          | One container                       | Many stateless app containers behind a load balancer, separate job workers |
| Database           | One PostgreSQL                      | Primary plus read replicas, connection pooling                             |
| Search             | PostgreSQL full-text                | OpenSearch adapter                                                         |
| Cache and sessions | PostgreSQL tables                   | Redis adapter                                                              |
| Pages              | Server-rendered with built-in cache | Same, behind a CDN with tag-based purge                                    |
| Files              | Local disk                          | S3-compatible storage                                                      |

Rules that make this possible, enforced from M0:

- App processes hold no state; anything shared lives behind an adapter interface (search, cache,
  queue, files) with a PostgreSQL default.
- Reads that may go to a replica are marked as such in the action definition.
- Lists are always paginated by cursor; nothing loads a whole table.
- Heavy work (imports, exports, reindexing, emails, reports) runs as background jobs.
- Each milestone seeds a large data set (1,000,000 products, 1,000,000 customers, 5,000,000
  orders) and checks that its pages and actions stay within budget.

The adapters themselves land in M10; M12 load-tests the large deployment and publishes the numbers.

## 6. Roadmap in detail

All work continues in one long-running chat (Iman, 2026-11-15). Notion and `PROGRESS.md` are the
memory: both are read at the start of every session and updated at the end. Every milestone ends with the three
test levels green, the QA report, Notion and `PROGRESS.md` updated.

### M0 Foundation

- Monorepo, tooling, CI workflow, Docker Compose for PostgreSQL.
- `core`: every contract in 4.2, the call path in 4.3, module enable and disable.
- `db`, `i18n`, auth with roles and 2FA, audit log, revisions.
- `server`: endpoints and OpenAPI generated from the registry.
- `cli`: `dev`, `migrate`, `inspect`, `add`, `module create`, `backup`, `restore`.
- `ui`: tokens, base components, three visual identity proposals for Iman to choose from.
- **Installer**: `npm create @aicommerce` then a setup page:
  1. database check
  2. admin account with 2FA
  3. shop name, country, currency, language
  4. choose a preset or tick features one by one, with dependencies resolved and explained
  5. optional AI provider key
  6. optional import from an existing shop (available from M3)
  7. optional sample data

  The page needs a one-time token printed in the terminal and locks itself when finished.

- Sample third-party module used as the contract test.

**Done when** a fresh install reaches a working (empty) shop through the setup page for `minimal`
and `full`; the sample module can be switched off and on with data intact; the sample action
returns 200, 403 and 400 correctly and audits each call.

### M1 Catalog, storefront, AI admin

- `catalog`: simple and configurable products, categories, merchant-created attributes, attribute
  sets, variants, swatches, prices, media gallery, video, related products.
- `search`: PostgreSQL full-text search, filters by attribute, sorting, suggestions.
- `seo`: clean URLs, redirects on rename, meta tags, structured data, sitemap.
- `storefront` and default theme: home, category, search, product page.
- `ai`: chat admin with Gemini; tools from the registry; artifacts with HTML, PDF and CSV
  download; confirm cards; undo; conversation history; "explain" answers that teach the merchant
  what was done and why; writing help for titles, descriptions and SEO text.
- Dashboard: generated screens for every resource, navigation, settings, activity log.
- Chat bar on every screen; do-it or show-it; trust levels Guide, Ask, Auto; "show your work".
- Inline editing on the storefront: title, description, price, gallery, attributes.
- MCP endpoint so Claude, ChatGPT and other clients can connect to the shop.
- Second and third providers (Claude, OpenAI) proven by configuration change.

**Done when** a visitor can browse, search and filter; an admin can create and edit the whole
catalog three ways (chat, classic, inline); the same chat script passes on all three providers.

### M2 Selling

- `customer`: accounts, address book, groups, password reset, login as customer, privacy export
  and deletion.
- `cart`: guest and customer carts, merge on login, persistent cart, mini cart.
- `checkout`: one-page flow, guest and account, several shipping and payment methods, wallets
  (Apple Pay, Google Pay), coupons field, order notes, terms agreement, address validation hook,
  abandoned-cart recovery emails.
- `payment`: Stripe, bank transfer, cash on delivery, the payment provider contract.
- `shipping`: flat rate, free shipping, table rates, the carrier contract.
- `tax`: rates and classes by country and region, prices with or without tax.
- `sales`: orders, invoices, shipments, refunds, cancellations, order numbers, PDF documents,
  order comments, reorder.
- `email`: transactional emails with editable templates.
- Customer area: orders, addresses, account details.
- Chat: "today's orders", "refund order 1042", "who has not paid", with artifacts.
- `starter` preset complete, with chat-led setup for a small shop.
- AI duties engine (3c) and the shopper assistant (3f).

**Done when** a real test payment is taken, the order is invoiced, shipped and refunded, and every
email arrives; a small shop goes from install to first order through the chat alone.

### M3 Migration

- `migrate` engine: common intermediate format, dry run with a report, resumable, re-runnable for
  changes only, per-entity mapping, media download, ID map kept for later runs.
- Connectors: Magento 2 (read-only database or REST), Shopify (Admin API), Shopware 6 (Admin
  API), CSV.
- Entities: products, variants, categories, attributes, media, customers, addresses, order
  history, URL redirects, coupons where they exist.
- Passwords: Magento hashes verified and upgraded at first login. Shopify does not export
  passwords, so those customers get a set-password email.
- Started from the installer, the CLI, or the chat ("import my Shopify store").
- A migration guide per source in Notion and `docs/`.

**Done when** this Magento 2.4.9 install, a Shopware 6 instance and a Shopify development store
are each imported, counts match the dry-run report, a migrated Magento customer can log in with
their old password, and old product URLs redirect.

### M4 Content

- Pages, reusable blocks, navigation menus, media library with folders and image optimisation.
- Visual page builder: drag sections onto the real page, edit inline, responsive preview.
- Widgets (product lists, banners), contact form, cookie notice.
- Chat: "make a landing page for the winter sale" produces a draft page to review.
- Importers extended: pages and blocks.

**Done when** a merchant builds a home page and a landing page without touching code, by hand and
by chat.

### M5 Promotions and pricing

- Catalog price rules, cart price rules with conditions and actions, coupons (single, generated
  batches, usage limits), free shipping rules, buy X get Y.
- Tier prices, customer-group prices, special prices with dates, minimum advertised price.
- Rule builder UI, and rules written by chat ("10% off shoes for members this weekend").
- Importers extended: rules and coupons.

**Done when** a set of Magento sample-data rules produces the same totals here as in Magento.

### M6 Channels and languages

- Several shops on one install: domains, catalog subsets, price lists, themes, settings.
- Locales, translations of catalog and content, language switcher, language packs as packages.
- Currencies, exchange rates, currency switcher.
- Full tax rules: zones, customer and product classes, cross-border, fixed product taxes.
- Chat: translate the catalog into a new language as drafts for review.
- Importers extended: store views and translations.

**Done when** one install serves two shops in three languages and two currencies, including a
right-to-left language.

### M7 Inventory

- Sources, stocks per channel, reservations, source selection on shipment, backorders, low-stock
  notifications, in-store pickup, stock import and export.
- Importers extended: multi-source stock.

**Done when** an order reserves stock, shipment deducts it from the chosen source, and pickup
works end to end.

### M8 More product types and engagement

- Bundle, grouped, downloadable and virtual products.
- Wishlist, compare, reviews and ratings with moderation, back-in-stock and price alerts, recently
  viewed, share by email.
- Importers extended: all product types, reviews, wishlists.

**Done when** each Magento product type can be created, bought and imported.

### M9 Marketing and reports

- Newsletter, customer segments (basic), email campaigns hook, RSS.
- Tracking: GA4, Tag Manager, consent-aware.
- Reports: sales, products, customers, carts, search terms, as chat artifacts and classic screens.
- SEO tools: robots, canonical rules, redirect manager.

**Done when** every Magento report has an equivalent answer in the chat with a downloadable
artifact.

### M10 Integrations and operations

- Webhooks, scoped API tokens, integrations screen.
- Carriers: UPS, USPS, FedEx, DHL with live rates and labels.
- PayPal, saved cards, one-click purchase, multi-address shipping, gift messages.
- Remote file storage (S3-compatible), optional OpenSearch and Redis adapters.
- Bulk import and export of every entity, scheduled.

**Done when** a shop runs with files on S3, search on OpenSearch and a live carrier rate at
checkout.

### M11 Adobe Commerce parity

- B2B: companies and roles, shared catalogs, negotiable quotes, requisition lists, quick order,
  purchase approvals, payment on account.
- Advanced customer segments, dynamic content, related-product rules.
- Scheduled changes with preview.
- Returns, store credit, reward points, gift cards, gift registry, gift wrapping.
- Private sales, visual merchandising, AI product recommendations and search ranking.
- Importers extended: Adobe Commerce data.

**Done when** every row of the parity map is checked off.

### M12 Proof and launch

- Benchmarks against this Magento install on the same machine and catalog.
- External-style security review, accessibility audit, load test.
- Public docs site, contribution guide, example modules and theme.
- Measured comparison table with Magento, Shopify and Shopware.
- Version 1.0.
- Project website at **https://aicommerce.iranimij.net** (Iman, 2026-11-15). Built only when the
  product is finished:
  - Hugo, built the same way as Iman's other project sites (radicard-website, magento-website):
    - custom templates and no theme;
    - Tailwind v4 through Hugo's `css.TailwindCSS`;
    - a double build so Tailwind sees `hugo_stats.json`.
  - Content:
    - a professional landing page;
    - documentation of every part of the project, taken from `docs/`;
    - a blog that starts with three posts.
  - Colours come from the chosen logo.
  - It lives in its own **private** repository, `iranimij/aicommerce-website`, at
    `~/Projects/aicommerce-website`.
  - Every change to `main`, whether by pull request or direct push, deploys automatically. It uses
    the `deploy.yml` pattern from magento-website:
    1. Build on every pull request; deploy only from `main`.
    2. rsync to `releases/<sha>`.
    3. `activate.sh` swaps a symlink.
    4. An nginx container serves the site on a free localhost port (8081 to 8084 are taken).
    5. The host nginx handles TLS with Let's Encrypt.
    6. A smoke test runs against the live site.
  - DNS for `aicommerce.iranimij.net` already exists (Iman added it).
  - Iman must provide:
    - the deploy secrets `SSH_PRIVATE_KEY`, `SSH_KNOWN_HOSTS`, `SSH_HOST`, `SSH_PORT`,
      `SSH_USER`;
    - the deploy key in `authorized_keys`;
    - the one-time certbot and vhost setup with sudo.

**Done when** every claim in the comparison table has a number or a reproducible test behind it.

## 7. How each milestone chat runs

1. Read `PROGRESS.md` and the milestone page in Notion.
2. Write the milestone's detailed design note and implementation plan; Iman approves.
3. Build test-first.
4. Run all three test levels, then the QA gate.
5. Update Notion (build log, QA report, roadmap, parity map) and `PROGRESS.md`.
6. Hand Iman the prompt that starts the next chat.

## 8. Notion structure

Page **AI Commerce** under Projects (`345563c039fc80269c8fd1e967ea4c8b`), each sub-page written to
be read on its own:

- 01 · Vision and positioning
- 02 · Design (architecture, security, AI admin, design system)
- 03 · Roadmap (M0 to M12, scope and done-when for each)
- 04 · Feature parity map (Magento, Adobe Commerce, Shopify, Shopware)
- 05 · Installation and presets
- 06 · Migration (Magento, Shopify, Shopware)
- 07 · Module, theme and language pack developer guide
- 08 · Testing and QA (rules, plus one report per milestone)
- 09 · Comparison with Magento, Shopify and Shopware
- 10 · Decisions log
- 11 · Build log

## 9. Steps in this chat (after approval)

1. Rename `~/Projects/openstore` to `~/Projects/ai-commerce` and the design doc to
   `2026-11-15-ai-commerce-design.md`.
2. Bring the design doc in line with this plan.
3. Create the Notion pages in section 8.
4. Write the M0 implementation plan to
   `~/Projects/ai-commerce/docs/superpowers/plans/2026-11-15-m0-foundation.md` and create
   `PROGRESS.md`.
5. Add `README.md`, `LICENSE` (MIT) and `.gitignore`, commit, create the public repository
   `iranimij/ai-commerce` with `gh`, and push. No Claude attribution in any commit.
6. Save a project memory (paths, Notion link, repo, decisions) and hand over the prompt for the
   M0 chat.

The Gemini API key is first needed in M1. I will create it in the browser then and store it in a
git-ignored `.env`.

## 10. Verification of this chat

- The folder is renamed and the design doc matches this plan.
- All eleven Notion pages open and are complete.
- The M0 plan file and `PROGRESS.md` exist.

Per-milestone verification is each milestone's "Done when" plus the standards in section 5.

## 11. Risks, stated plainly

- **Size.** This is the scope of a product that took Magento many years and a large team. Thirteen
  milestones, several of them multi-chat, is many months of steady work. The order is chosen so
  there is a usable shop after M2 and a migration path after M3, whatever happens later.
- **Ecosystem.** Magento and Shopify have thousands of extensions and we start with none. The
  platform can be better; the marketplace cannot be, for a long time.
- **AI reliability.** Models make mistakes. The confirm gate, undo, audit log and the classic
  screens are what keep that safe. They are not optional extras.
- **Shopify testing** needs a development store that Iman provides.
- **Comparison claims** are targets until M12 measures them.

## 12. Not in this plan

- No product code is written in this chat; only the design, plans and repository setup.
- No hosted service, no extension marketplace, no mobile app.
- WooCommerce and other import sources; the engine leaves room for them.

Date: 2026-11-15 · Approved by Iman on 2026-11-15.

## 13. Magento parity map

Source: the 410 packages in this Magento 2.4.9 install, plus Adobe Commerce's feature list (Adobe
Commerce code is not in this install, so that part is from documentation, not from code).

| Area                                                                                                   | Magento modules                                                                         | AI Commerce module                      | Milestone |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------- | --------- |
| Framework, DI, plugins, events, cron, queue, cache, indexer                                            | framework, cron, message-queue, amqp, indexer, cache-invalidate, page-cache             | `core`                                  | M0        |
| Admin users, roles, ACL, 2FA, captcha, security                                                        | user, authorization, backend, security, two-factor-auth, captcha, re-captcha-*          | `core`, `auth`                          | M0        |
| Admin UI                                                                                               | ui, backend, theme-adminhtml-backend                                                    | `admin`, `ai`                           | M1        |
| Catalog, attributes, categories, media                                                                 | catalog, eav, media-gallery-*, media-storage, product-video, swatches                   | `catalog`, `media`                      | M1        |
| Configurable products                                                                                  | configurable-product                                                                    | `catalog`                               | M1        |
| Search, layered navigation                                                                             | catalog-search, search, elasticsearch, open-search, layered-navigation, advanced-search | `search`                                | M1        |
| Storefront theme                                                                                       | theme, theme-frontend-luma, require-js, widget                                          | `storefront`, `ui`                      | M1        |
| URL rewrites, SEO                                                                                      | url-rewrite, catalog-url-rewrite, cms-url-rewrite, sitemap, robots                      | `seo`                                   | M1, M9    |
| Customers, addresses, groups                                                                           | customer, persistent, login-as-customer-*                                               | `customer`                              | M2        |
| Cart, checkout                                                                                         | quote, checkout, checkout-agreements, multishipping, instant-purchase, gift-message     | `cart`, `checkout`                      | M2, M10   |
| Orders, invoices, shipments, credit memos                                                              | sales, sales-sequence, order-cancellation                                               | `sales`                                 | M2        |
| Payments                                                                                               | payment, offline-payments, paypal, payment-services-*, vault, cardinal-commerce         | `payment`, `payment-*`                  | M2, M10   |
| Shipping                                                                                               | shipping, offline-shipping, ups, usps, fedex, dhl                                       | `shipping`, `shipping-*`                | M2, M10   |
| Tax                                                                                                    | tax, weee                                                                               | `tax`                                   | M2, M6    |
| Email                                                                                                  | email, variable, newsletter                                                             | `email`, `newsletter`                   | M2, M9    |
| CMS, page builder                                                                                      | cms, page-builder, widget                                                               | `content`                               | M4        |
| Price rules, coupons, tier and group prices, MSRP                                                      | catalog-rule, sales-rule, rule, msrp                                                    | `promotions`, `pricing`                 | M5        |
| Websites, stores, locales, currencies, translation                                                     | store, directory, currency-symbol, translation, language-*                              | `channels`, `i18n`                      | M6        |
| Multi-source inventory, pickup                                                                         | inventory-* (about 90 packages), catalog-inventory                                      | `inventory`                             | M7        |
| Bundle, grouped, downloadable, virtual products                                                        | bundle, grouped-product, downloadable                                                   | `catalog-*`                             | M8        |
| Wishlist, compare, reviews, alerts, related products, send to friend                                   | wishlist, review, product-alert, send-friend, compare-list-graph-ql                     | `engagement`                            | M8        |
| Reports, analytics, tracking                                                                           | reports, analytics, google-gtag, google-analytics, new-relic-reporting                  | `reports`, `tracking`                   | M9        |
| RSS, contact form, cookies                                                                             | rss, contact, cookie                                                                    | `content`                               | M9        |
| Import, export                                                                                         | import-export, *-import-export                                                          | `data`                                  | M10       |
| API, integrations, webhooks                                                                            | webapi, graph-ql, *-graph-ql, integration, swagger                                      | `core` (generated), `integrations`      | M0, M10   |
| Remote storage                                                                                         | remote-storage, aws-s3                                                                  | `media`                                 | M10       |
| B2B: companies, shared catalogs, quotes, requisition lists, quick order, approvals, payment on account | Adobe Commerce                                                                          | `b2b`                                   | M11       |
| Customer segments, dynamic blocks, related product rules                                               | Adobe Commerce                                                                          | `segments`                              | M11       |
| Content staging, scheduled changes, preview                                                            | Adobe Commerce                                                                          | `staging`                               | M11       |
| RMA, store credit, reward points, gift cards, gift registry, gift wrapping                             | Adobe Commerce                                                                          | `returns`, `loyalty`, `giftcard`        | M11       |
| Private sales, visual merchandiser, admin action log                                                   | Adobe Commerce                                                                          | `events`, `merchandising`, `core` audit | M11       |
| Live search, product recommendations                                                                   | Adobe Commerce services                                                                 | `search`, `ai`                          | M11       |

| Migration from other platforms | Data Migration Tool (Magento 1 only) | `migrate` | M3, extended in every later milestone |

## 14. Comparison with Magento, Shopify and Shopware

The AI Commerce column lists design targets. Nothing in it is a measured result until M12, which
tests each row against this Magento 2.4.9 install and against current Shopify and Shopware. The
Shopify and Shopware columns are from general knowledge on 2026-11-15 and are re-checked in M12.

|                                                | Magento 2.4.9                                        | Shopify                                                 | Shopware 6                                         | AI Commerce (target)                                       | How M12 proves it                             |
| ---------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| Source and licence                             | Open source (OSL), paid Adobe Commerce edition       | Closed, hosted only                                     | Open source core, paid plans for advanced features | Open source, MIT, every feature free                       | Licence file                                  |
| Hosting                                        | Self-hosted or Adobe cloud                           | Shopify only                                            | Self-hosted or cloud                               | Self-hosted, one container to many                         | Install from zero                             |
| Languages a developer needs                    | PHP, XML, Knockout, RequireJS, LESS                  | Liquid, plus any language for apps                      | PHP, Twig, Vue                                     | TypeScript only                                            | Languages in one module                       |
| Files to add one admin-managed entity with API | About 20 to 30                                       | Not possible inside the platform; needs an external app | About 10 to 15                                     | One schema file, one actions file                          | Same sample module built on each              |
| Changing core behaviour                        | Plugins on any public method, observers, preferences | Limited to what the APIs and Functions expose           | Decorators, events, subscribers                    | Typed events and named pipelines, fully inspectable        | `inspect` shows the full chain                |
| Custom fields                                  | EAV, extension attributes                            | Metafields                                              | Custom fields                                      | Typed attributes, created in code or by the merchant       | Queries per product page                      |
| Services needed to run                         | PHP, MySQL, OpenSearch, Redis, RabbitMQ, Varnish     | None (hosted)                                           | PHP, MySQL, OpenSearch optional                    | Node, PostgreSQL                                           | Fresh install                                 |
| Install                                        | Command line, many steps                             | Sign up                                                 | Web installer                                      | One command, then a web setup page with a feature picker   | Timed install                                 |
| Small shop                                     | Same heavy install for everyone                      | Good                                                    | Reasonable                                         | `minimal` and `starter` presets, set up by conversation    | Time from install to first order              |
| Very large shop                                | Proven                                               | Proven on Plus                                          | Proven                                             | Same code, scaled deployment                               | Load test with 1M products, published numbers |
| Admin                                          | About 200 form and grid screens                      | Polished screens, AI assistant alongside                | Modern screens, AI features in paid plans          | Chat first, with artifacts; generated screens as fallback  | 10 scripted admin tasks, timed                |
| Editing on the storefront                      | No                                                   | Theme editor for layout                                 | Shopping Experiences editor                        | Inline edit of any content on the real page                | Same 10 tasks                                 |
| AI coverage of admin actions                   | None in core                                         | Partial, vendor-chosen                                  | Partial, paid                                      | Every action, including third-party modules, automatically | Share of actions reachable by chat            |
| Choice of AI provider                          | Not applicable                                       | No                                                      | No                                                 | Gemini, Claude, OpenAI, by configuration                   | Same script on three providers                |
| Open to external AI agents                     | No                                                   | Vendor-run                                              | No                                                 | MCP endpoint generated from the same actions               | Connect an external client                    |
| API                                            | REST and GraphQL written per module                  | Good, versioned                                         | Good                                               | Generated from actions, always complete                    | Share of actions with an endpoint             |
| Explain a price or total                       | No                                                   | No                                                      | No                                                 | Step-by-step trace                                         | Checkout test                                 |
| Undo and history                               | Limited                                              | Limited                                                 | Limited                                            | Every entity                                               | Restore test                                  |
| Storefront speed                               | Luma theme is heavy                                  | Good                                                    | Good                                               | Lighthouse 95+ on the default theme                        | Lighthouse, same catalog                      |
| Accessibility                                  | Partial                                              | Depends on theme                                        | Improving                                          | WCAG 2.2 AA                                                | Audit                                         |
| Migration in                                   | From Magento 1                                       | Importer apps                                           | Migration assistant (Magento, Shopware 5)          | Magento, Shopify, Shopware, CSV, with dry run and re-sync  | Import three real shops                       |
| Fees                                           | Free core; Adobe Commerce is costly                  | Monthly plan plus transaction fees                      | Free core; paid plans                              | None                                                       | Not applicable                                |
| Extensions available                           | Thousands                                            | Thousands                                               | Thousands                                          | None at launch                                             | Where we are behind                           |
| Track record                                   | 15+ years                                            | 15+ years                                               | 10+ years                                          | New                                                        | Where we are behind                           |

The last two rows are where every competitor is ahead and will stay ahead for some time.

## 15. Lessons from Magento and Shopware

Iman, 2026-11-15: find the important problems of Magento and Shopware and make sure AI Commerce
does not have them. Research was done on 2026-11-15 from security research (Sansec), official
docs and release notes, GitHub issues, and agency and developer write-ups, plus counts from the
local Magento 2.4.9 install. Cost and market-share figures in the sources are vendor estimates
and are not relied on here.

### Measured in the local Magento 2.4.9 install

| Measure                                                             | Count                   |
| ------------------------------------------------------------------- | ----------------------- |
| Packages in `vendor/magento`                                        | 410                     |
| PHP files / XML files in `vendor/magento`                           | 29,707 / 13,859         |
| `di.xml` files / plugins / preferences / observers declared by core | 521 / 876 / 1,598 / 454 |
| Generated PHP classes                                               | 4,602                   |
| Core tables / of which EAV value tables                             | 383 / 29                |
| Indexers                                                            | 28                      |
| Frontend: JS files / Knockout templates / LESS files                | 2,031 / 346 / 678       |

### Magento problems and how AI Commerce avoids them

| #   | Problem                                                                                         | Root cause                                                                             | How AI Commerce avoids it                                                                                                                                                                                                                                                                     | Where         |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Repeated unauthenticated mass compromise (CosmicSting 2024, SessionReaper 2025, PolyShell 2026) | Large anonymous API surface, object deserialisation, uploads stored under the web root | Every endpoint is an action with an explicit permission, and public actions are a short reviewed list. No deserialisation of user input: only Zod-validated JSON. Uploads stored outside the web root, re-encoded, served through a handler. A security test suite checks every public action | 4.3, 5.1; M0b |
| 2   | Upgrades and even security patches are projects                                                 | Extensions bind to concrete core classes and templates, not a narrow stable API        | Extensions can only use declared, versioned contracts (4.2a). `upgrade` lists affected overrides before applying. Security fixes are released as patch versions for every supported minor                                                                                                     | 4.2a; M0c     |
| 3   | Extensions conflict silently                                                                    | Plugins on any method, last-wins preferences, hand-picked sort orders                  | Wraps and pipeline steps have deterministic order. Two replacements of the same service fail at startup naming both. `inspect` shows the whole chain                                                                                                                                          | 4.2a; M0a     |
| 4   | Behaviour cannot be found by reading the code                                                   | Dozens of XML dialects merged at runtime, thousands of generated classes               | No XML, no code generation. Everything is TypeScript the editor can follow. `inspect` answers "what runs here"                                                                                                                                                                                | Principle 2   |
| 5   | Slow default storefront                                                                         | RequireJS, Knockout and LESS before the page is interactive                            | Server-rendered React with a JavaScript budget per page, checked in CI. Lighthouse 95+ is a release gate                                                                                                                                                                                      | 5.5; M1       |
| 6   | The owner's direction leaves open-source users behind                                           | Single-vendor product where the paid edition is the priority                           | Fully MIT, every feature free, no paid edition to protect. Public design and decision log                                                                                                                                                                                                     | Decision 3    |
| 7   | Security fixes reach open-source users late                                                     | Support policy written for the paid product                                            | One edition, so one security policy for everyone (SECURITY.md)                                                                                                                                                                                                                                | M0a           |
| 8   | High total cost of ownership                                                                    | The sum of 2, 4, 10 and 11                                                             | Two services to run, upgrades without projects, one language                                                                                                                                                                                                                                  | Throughout    |
| 9   | Indexing fragile at scale                                                                       | Derived data in index tables rebuilt by triggers and cron                              | No separate index layer by default: attributes live in indexed JSONB and search uses PostgreSQL. Derived data is updated by background jobs with retries, visible progress and alerts                                                                                                         | 5.7; M1       |
| 10  | Deploys need a build pipeline and cause downtime                                                | Mandatory code generation and static asset compilation                                 | One normal build. Migrations must be backward compatible with the running version, so deploys are rolling with no maintenance mode                                                                                                                                                            | M0c           |
| 11  | Heavy infrastructure                                                                            | PHP, MySQL, OpenSearch, Redis, Varnish, RabbitMQ all expected                          | Node and PostgreSQL only; the rest are optional adapters for large shops                                                                                                                                                                                                                      | 5.7           |
| 12  | Extension supply chain backdoors                                                                | Extensions from vendor servers with full rights, unsigned                              | Extensions come from npm with provenance, lockfile pinned. `add` shows what an extension declares (actions, permissions, network access) before install. A signed-extension registry is a later goal                                                                                          | M0c, M10      |
| 13  | EAV makes reads slow and queries complex                                                        | Attributes spread over typed value tables                                              | Attributes in one JSONB column per entity with indexes, validated by a registry                                                                                                                                                                                                               | 4.2; M1       |
| 14  | Checkout hard to customise, broken by CSP changes                                               | Deep Knockout tree configured by nested layout XML                                     | Checkout built from slots and pipelines from day one under a strict CSP, so extensions cannot rely on inline scripts                                                                                                                                                                          | M2            |
| 15  | Admin UI framework painful to extend                                                            | XML-declared grids and forms over an under-documented JS system                        | Admin screens generated from resources, with plain React components as the escape hatch                                                                                                                                                                                                       | 3b; M1        |
| 16  | No coherent frontend direction                                                                  | Several frontends shipped and abandoned                                                | One storefront stack. Headless use goes through the same actions, so extensions work in both                                                                                                                                                                                                  | M1            |
| 17  | Two incomplete APIs                                                                             | REST and GraphQL built separately                                                      | One API generated from actions: always complete by construction                                                                                                                                                                                                                               | 4.2           |
| 18  | Tests so slow people skip them                                                                  | Integration tests reinstall the whole application                                      | Each test file gets its own database schema; integration tests run in seconds. The module scaffold ships passing tests                                                                                                                                                                        | 5.2           |
| 19  | Marketplace code unverifiable                                                                   | Review once, encrypted builds later                                                    | Open source extensions on npm with provenance; no encrypted code                                                                                                                                                                                                                              | M10           |
| 20  | Each new generation is a replatform                                                             | No upgrade path for code                                                               | Versioned contracts and deprecation periods. Migration tools are part of the product                                                                                                                                                                                                          | 4.2a, M3      |

### Shopware problems and how AI Commerce avoids them

| #   | Problem                                                                                     | Root cause                                                           | How AI Commerce avoids it                                                                                                              | Where       |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Commercial pressure on the open-source edition (Fair Usage Policy, 2025)                    | MIT code, but updates and extensions flow through a vendor account   | No vendor account, licence server or usage reporting. Updates and extensions come from npm and GitHub                                  | Decision 3  |
| 2   | Major versions break admin extensions                                                       | Extensions override internal Vue components                          | Admin extensions use slots and resources, never internal components. The admin framework is not part of the contract                   | 4.2a        |
| 3   | Two extension systems with different reach                                                  | In-process plugins unsafe for SaaS, so a weaker app system was added | One module system. Out-of-process integrations use the same actions through webhooks and API tokens                                    | 4.2         |
| 4   | Data layer slow at scale                                                                    | Every read hydrates full entities and fires events                   | Actions read with plain typed queries (Drizzle). Events fire after commit, not per entity load. Large imports use bulk paths           | M0b, M3     |
| 5   | Extension store rental-only, tied to the vendor                                             | Commercial store model                                               | No store owned by us in the path of installing code                                                                                    | Decision 3  |
| 6   | Template overrides collide                                                                  | Plugins override named Twig blocks; order depends on install order   | Slots have explicit order and a declared owner. A slot replaced by two modules is a startup error                                      | 4.2a        |
| 7   | Key features closed-source and plan-gated (B2B)                                             | Commercial edition                                                   | B2B and every Adobe Commerce level feature are MIT                                                                                     | M11         |
| 8   | Unsafe background defaults (queue processed by the admin's browser, silent search fallback) | Defaults made for shared hosting                                     | Jobs run in a worker process, which is part of the default container. Failures are visible in the admin and never silent               | M0b         |
| 9   | Variant-heavy catalogues slow                                                               | Variants as full product rows with inheritance at read time          | Variants stored as compact rows under the parent; listing filters read from indexed JSONB. Seeded test with 1,000 variants per product | M1          |
| 10  | Headless storefront cannot use plugins                                                      | Plugins ship templates, not API                                      | Every module feature is an action first, so headless storefronts get it automatically                                                  | 4.2         |
| 11  | Minor updates break shops                                                                   | No enforced compatibility contract within a major                    | Contract tests: the sample third-party module runs against every core change in CI                                                     | 5.2         |
| 12  | Version 5 to 6 was a rewrite                                                                | New architecture                                                     | Versioned contracts with deprecation periods                                                                                           | 4.2a        |
| 13  | Rules evaluated on every request                                                            | Rule engine design                                                   | Rules are compiled once when saved and evaluated only where they apply                                                                 | M5          |
| 14  | Steep Shopware-specific learning curve                                                      | Own data layer, own admin framework, two extension models            | Plain TypeScript, standard libraries, one extension model                                                                              | Principle 2 |

### What both do well, which AI Commerce must keep

- Magento: multi-website, multi-store, multi-language and multi-currency scoping; the depth of
  native commerce features; merchant-defined attributes; anything can be customised; packaging by
  a standard package manager; a large agency ecosystem.
- Shopware: a modern readable codebase; API-first with one validated write path; Rule Builder,
  Flow Builder and Shopping Experiences built in; a clean admin; sales channels; public
  architecture decision records.

AI Commerce adopts public decision records: the Notion decisions log is mirrored to
`docs/decisions/` from M0b.
