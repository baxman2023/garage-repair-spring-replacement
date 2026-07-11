# Merge-Field Conventions (WO-026)

Every CopyForge email uses double-brace, snake_case merge tokens: `{{field_name}}`.
The canonical list lives in `packages/core/src/contracts/emailSequence.ts`
(`MERGE_FIELDS`) and is enforced at generation time — an email using a token
not on this list is rejected, because ESPs silently deliver unknown tokens as
literal text.

| Token | Meaning | Rules |
| --- | --- | --- |
| `{{first_name}}` | Subscriber's first name | ESP must configure a fallback (e.g. "friend"). |
| `{{cta_link}}` | THE call-to-action URL | **Exactly one per email body** — the single-CTA rule. Subjects/previews never contain it. |
| `{{unsubscribe_link}}` | List-unsubscribe URL | Compliance; belongs in the footer. |
| `{{product_name}}` | Offer/product display name | |
| `{{founder_name}}` | Founder/sender display name | Signatures. |
| `{{webinar_link}}` | Webinar join/replay URL | Webinar-adjacent emails only (reminders, replay). |
| `{{deadline_date}}` | Human-readable close date | Legitimate-urgency sequences only — never used to fake scarcity. |

Conventions:

- Tokens are lowercase snake_case inside `{{ }}`; optional inner whitespace is
  tolerated on parse but generators emit the tight form.
- **Single CTA**: each email body contains exactly one `{{cta_link}}`. The same
  destination may be *described* twice, but only one live token ships.
- No token ever appears in a subject line except `{{first_name}}`.
- Adding a field: extend `MERGE_FIELDS` (code) and this table (docs) in the
  same commit.
