# User experience preferences

Preferences belong to the authenticated User, independently of Organization
membership and the Mexican fiscal domain. Better Auth remains the only account
and session system. Its `name` field is retained; new registrations also store
`givenName` and `familyName`. Existing accounts are not split or renamed.

## Persistence and resolution

`UserPreference` retains its user key and accent. Nullable overrides add theme,
locale, timezone and professional role, with `updatedAt`, an integer revision,
and an onboarding completion timestamp. The additive migration
`20261012000000_user_experience` does not delete or rename existing data.
Legacy NULL values resolve to platform DARK / es-MX / UTC; they are not inferred
from email, fiscal country or currency. The role remains unspecified until chosen.

Resolution is per dimension: user override > organization default > product
default. The resolver accepts optional organization defaults, but there is no
organization preference model, API or management screen yet: the current product
has no such configuration to persist. Adding it later must use an authorized
membership context, never an arbitrary client organization ID.

`GET /api/user/preferences` and `POST /api/user/preferences` require the existing
session. POST checks same origin, rate limits writes and parses a strict allowlist.
The server derives the user ID. Revision-bearing writes use a transaction and
compare-and-increment; stale writes return `PREFERENCES_CONFLICT` (409). The legacy
accent-only transport stays compatible and increments the same revision.
Responses contain only preference fields, never names, email or internal IDs.

Settings apply a theme/locale change only after server confirmation. On conflicts
or ambiguous network failures they reload the canonical state before retrying.
Reloads and new devices resolve persisted preferences server-side.
Delayed HTTP responses and SSR snapshots cannot move confirmed state to an older
revision.
This is not a live push synchronization service: an already open device reconciles on its next
write, page refresh or new server-rendered snapshot.

## Theme and localization

The root server layout resolves theme and locale before emitting `data-theme`
and `lang`, with no inline bootstrap script or browser-storage preference cache.
Authenticated state therefore appears in the first HTML response. Anonymous
users start DARK / es-MX; unpersisted wizard choices are memory-only previews.
Personalizing the root layout makes public page rendering dynamic; robots,
sitemap and canonical metadata remain unchanged. Do not place personalized HTML
in a shared cache.

Semantic tokens cover text, muted text, backgrounds, surfaces, borders, focus,
errors, dashboard navigation, shared form fields, fiscal/CSD/Studio presentation
and chart tooltips. No fiscal behavior, signing or stamping is changed. Theme
currently permits LIGHT/DARK; adding SYSTEM requires explicit resolution of the
system preference plus an additive enum change, not removing existing values.

`SUPPORTED_LOCALES` is the central BCP 47 allowlist (es-MX/en-US); persistence is a
string, not a per-locale Prisma enum. Modular typed namespaces are common, auth,
onboarding, navigation, settings and errors. APIs reject unsupported locales;
display boundaries fall back to es-MX. Tests assert dictionary key parity.
Date helpers take a timezone explicitly and currency helpers take currency
explicitly; changing language does not change either. Nullable timezone overrides
accept named IANA zones, not numeric offsets, and are not asked during onboarding.

The wizard, relevant settings, login controls, organization continuation and
shared navigation are translated. Legacy dashboard page descriptions, fiscal
forms and validations, invoice/ticket content, support/notifications, recovery
emails and cookie/legal copy still need their own localization work. Legal text
translations require review, not automatic dictionary replacement. The app is
not yet completely bilingual. RFC, SAT keys, CFDI identifiers and persisted fiscal
data are never translated.

## Communications and consent

CommunicationPreference has one operational boolean per user/category:
NEWS_UPDATES, PRODUCT_NEWS and COMMERCIAL_OFFERS. Absence is false. Essential
security/account/service messages are a distinct purpose with no opt-out toggle.
Browser cookies/analytics and existing LegalAcceptance are separate systems.

CommunicationConsentRecord is an append-only ledger: user, type, GRANTED/REVOKED,
version, contentHash, textLocale, source, optional jurisdiction and recordedAt.
The database rejects UPDATE/DELETE of evidence. Grants use server-owned policy
metadata; revocations retain the last granted text's snapshot. Defaults, absent
preferences and repeating the same decision do not manufacture consent evidence.
The restricted user foreign key preserves evidence: a future account deletion
workflow must explicitly resolve legal retention/anonymization; none is added here.

There is currently no approved communication policy. The current notice is DRAFT
and its marketing purpose has not been legally authorized. Optional checkboxes
remain OFF/unavailable and the server rejects enablement with
COMMUNICATIONS_UNAVAILABLE. No document is published or marked reviewed. The
internal service accepts a policy parameter for isolated evidence tests; that
parameter is never accepted in the API or enabled in product configuration.
Before real opt-ins, implement reviewed, versioned purpose-specific texts and
connect their production gate to the policy resolver. Delivery infrastructure is
also separate and is not implemented by preferences.

## Registration and continuation

The five steps are appearance, language, communications, professional role and
account. Stable role IDs have translated labels; no free-text profiling is stored.
Real fieldsets/radios, back/continue, focus transfer and compact mobile progress
support keyboard use. Name/email remain in memory when navigating backwards;
passwords remain only in uncontrolled inputs and the necessary auth request.
They are cleared on backwards navigation and submission, never stored or sent
to analytics. A ref lock prevents synchronous double submissions.

Better Auth creates the account and session first. Preferences are then saved
with a completion marker. A confirmed account whose preference write fails can
resume without registering again. An uncertain account creation instructs login
or recovery rather than automatically creating a second account. Existing
name-only accounts retain their original continuation behavior. New structured
accounts with unfinished preferences are redirected to the resumable wizard.

`/api/auth/continue`, existing OrganizationForm and membership selection are
reused. Organization onboarding creates the existing authorized workspace and
continues to fiscal profile; other OrganizationForm usages retain their dashboard
destination. Foreign memberships cannot be selected. This work neither advances
to stamping nor enables PAC.

Email verification is not configured in the current Better Auth setup. New
accounts remain unverified; no fake verification message or bypass is added.
Existing password recovery requires the real transactional mail configuration.

## Global readiness and limits

Locale, country, timezone and currency are independent dimensions. No country or
currency selector/model is added. Any future country field must use ISO codes;
Mexico is still the sole fiscal engine. A third language needs its allowlist and
catalog entry, complete dictionary namespaces, native-language review and tests;
there is no locale schema migration. A second country requires a separately
specified market/legal/fiscal domain and authorized ISO country configuration,
not an English-language toggle. Organization defaults are a resolver extension
point, not claimed as an implemented organization feature.

The migration is versioned and validated on isolated local PostgreSQL/PGlite only.
It must be reviewed and applied through an explicitly authorized deployment
workflow before this code runs against an existing persistent environment.

`npm test` runs test files serially to bound the memory of independent local
PGlite/Prisma engines. The explicit concurrent requests inside each integration
test still run concurrently; no assertion or test is skipped.
