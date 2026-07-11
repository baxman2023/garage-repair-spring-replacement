/**
 * The read-only sample funnel (WO-054): a curated snapshot of a finished
 * 5-market build for the fixture product ("SpringGuard", garage-door spring
 * replacement). Static by design — new users can inspect a finished build
 * before their first token is spent, and nothing here is mutable.
 */

export interface DemoAsset {
  type: string;
  gates: Record<'G3' | 'G4' | 'G5' | 'G6' | 'G7', 'pass'>;
  headline: string;
  excerpt: string;
}

export interface DemoMarket {
  rank: number;
  label: string;
  awareness: string;
  sophistication: number;
  entryConversation: string;
  assets: DemoAsset[];
}

const ALL_PASS = { G3: 'pass', G4: 'pass', G5: 'pass', G6: 'pass', G7: 'pass' } as const;

const stack = (m: {
  vslHl: string; vslEx: string;
  letterHl: string; letterEx: string;
  quizHl: string; quizEx: string;
  emailHl: string; emailEx: string;
}): DemoAsset[] => [
  { type: 'vsl', gates: ALL_PASS, headline: m.vslHl, excerpt: m.vslEx },
  { type: 'sales_letter', gates: ALL_PASS, headline: m.letterHl, excerpt: m.letterEx },
  { type: 'quiz', gates: ALL_PASS, headline: m.quizHl, excerpt: m.quizEx },
  { type: 'email_sequence', gates: ALL_PASS, headline: m.emailHl, excerpt: m.emailEx },
];

export const DEMO_PRODUCT = {
  name: 'SpringGuard — same-day garage spring replacement',
  offer: 'Same-day torsion spring replacement with a five-year no-snap warranty, $499 flat.',
  math: 'G1 pass: $499 price · 80% margin · meta CPC $2.10 → breakeven CVR 0.53%, target 1.4%.',
};

export const DEMO_MARKETS: DemoMarket[] = [
  {
    rank: 1,
    label: 'The 6am Bang',
    awareness: 'problem',
    sophistication: 2,
    entryConversation: '"Something just exploded in my garage and now the door won\'t open."',
    assets: stack({
      vslHl: 'That bang at six in the morning was your spring letting go — here is the fifteen-minute fix.',
      vslEx: 'The car is trapped. Work starts in two hours. And the one part that failed is the one part nobody stocks…',
      letterHl: 'Your garage door did not break. One forty-dollar spring did.',
      letterEx: 'Every torsion spring is rated in cycles. Yours was rated for ten thousand. This morning was cycle ten thousand and one…',
      quizHl: 'What did your garage door just do?',
      quizEx: 'Six symptom questions route each visitor to their diagnosis — bang, grind, tilt, stall, or silence.',
      emailHl: 'The door is fixable today (here is what the bang actually was)',
      emailEx: 'Seven emails: diagnosis → proof → guarantee → deadline, one idea each, no stacked CTAs.',
    }),
  },
  {
    rank: 2,
    label: 'The Slow Grind',
    awareness: 'problem',
    sophistication: 3,
    entryConversation: '"It still opens, but that screech gets worse every week."',
    assets: stack({
      vslHl: 'A healthy garage door is silent. Yours is announcing exactly which part is dying.',
      vslEx: 'That screech is metal on metal where grease used to be — and the spring is doing the suffering…',
      letterHl: 'The screech is a countdown.',
      letterEx: 'Doors do not fail on quiet days. They fail the morning you are already late…',
      quizHl: 'How loud is your garage door this week?',
      quizEx: 'Symptom-progression routing separates maintenance cases from replacement cases.',
      emailHl: 'What the screech means (and the one thing not to spray on it)',
      emailEx: 'WD-40 on a torsion spring makes tomorrow quieter and next month worse. Here is why…',
    }),
  },
  {
    rank: 3,
    label: 'The New Homeowner',
    awareness: 'unaware',
    sophistication: 1,
    entryConversation: '"The inspection said the garage door is \'aging\'. What does that even mean?"',
    assets: stack({
      vslHl: 'Your inspection report buried the one line that traps cars.',
      vslEx: '"Springs show wear" on page nine means one thing: the previous owner got out before the bill…',
      letterHl: 'The previous owner knew.',
      letterEx: 'Spring wear is invisible until the day it is not. A five-minute cycle count tells you which day…',
      quizHl: 'How old is the door you just bought?',
      quizEx: 'Age + usage questions estimate remaining spring cycles and route to inspect vs replace.',
      emailHl: 'The page-nine line your inspector wanted you to notice',
      emailEx: 'A welcome sequence that teaches cycle ratings before it ever mentions price.',
    }),
  },
  {
    rank: 4,
    label: 'The DIY Regret',
    awareness: 'solution',
    sophistication: 4,
    entryConversation: '"I watched the video. I bought the winding bars. Then I read what happens when it slips."',
    assets: stack({
      vslHl: 'The video made spring winding look easy. The emergency room disagrees.',
      vslEx: 'Three hundred pounds of stored torque, two winding bars, one slip. Here is the honest math…',
      letterHl: 'You were right to stop.',
      letterEx: 'This letter respects the research you already did — and prices the fix against the tool kit you almost bought…',
      quizHl: 'How far did your DIY plan get?',
      quizEx: 'Routing by research depth: watchers, part-buyers, and half-finishers get different proof.',
      emailHl: 'The part of the tutorial they cut',
      emailEx: 'Objection-led sequence for the most skeptical market — price transparency first.',
    }),
  },
  {
    rank: 5,
    label: 'The Landlord',
    awareness: 'product',
    sophistication: 3,
    entryConversation: '"Tenant says the garage door is stuck again. I need this handled without me driving over."',
    assets: stack({
      vslHl: 'Handle the tenant call without leaving your desk.',
      vslEx: 'Book online, technician coordinates with the tenant directly, photo report when it is done…',
      letterHl: 'The three-text fix for the garage door complaint.',
      letterEx: 'Forward the booking link. Get the photo report. File the invoice. That is the whole process…',
      quizHl: 'How many doors do you manage?',
      quizEx: 'Portfolio-size routing: single-property landlords vs managers get different offers.',
      emailHl: 'Your tenant already texted you about this',
      emailEx: 'Short B2B-flavored sequence: process, paperwork, priority scheduling for portfolios.',
    }),
  },
];
