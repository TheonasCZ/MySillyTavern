/** Calendar event templates (plan M23.3) — Pure template generation, NO AI.
 *  A pool of 20 generic fantasy holidays (Czech names) is hardcoded. On chat
 *  creation, 5 events are randomly picked and assigned concrete days. */

export interface CalendarEventTemplate {
  id: string;
  chatId: string;
  day: number;
  monthName: string;
  year: number;
  title: string;
  description: string;
  icon: string;
}

interface EventTemplateDef {
  title: string;
  monthIndex: number; // 0–11
  dayRange: [number, number]; // inclusive
  description: string;
  icon: string;
}

/** Pool of 20 generic fantasy holiday templates (Czech). */
const EVENT_TEMPLATES: EventTemplateDef[] = [
  {
    title: "Slavnost sklizně",
    monthIndex: 7, // Měsíc sklizně
    dayRange: [10, 20],
    description: "Celá ves slaví konec sklizně. Stoly se prohýbají pod tíhou jídla a pití.",
    icon: "🌾",
  },
  {
    title: "Den mrtvých",
    monthIndex: 10, // Měsíc sněhu
    dayRange: [25, 30],
    description: "Lidé zapalují svíce na památku zesnulých. Hranice mezi světy je tenká.",
    icon: "🕯️",
  },
  {
    title: "Jarní rovnodennost",
    monthIndex: 1, // Jarní vítr
    dayRange: [15, 20],
    description: "Den a noc jsou v rovnováze. Druidové provádějí obřady obnovy.",
    icon: "🌿",
  },
  {
    title: "Slunovrat",
    monthIndex: 4, // Měsíc žáru
    dayRange: [18, 24],
    description: "Nejdelší den roku. Ohně hoří celou noc, lidé tančí a zpívají.",
    icon: "🔥",
  },
  {
    title: "Zimní slunovrat",
    monthIndex: 11, // Měsíc temnoty
    dayRange: [18, 24],
    description: "Nejdelší noc roku. Lidé se scházejí u krbů a vyprávějí staré příběhy.",
    icon: "🌑",
  },
  {
    title: "Den hrdinů",
    monthIndex: 3, // Měsíc slunce
    dayRange: [1, 10],
    description: "Vzpomínka na padlé hrdiny. Rytíři skládají sliby, pěvci opěvují staré činy.",
    icon: "⚔️",
  },
  {
    title: "Trh v městě",
    monthIndex: 5, // Měsíc bouří
    dayRange: [5, 15],
    description: "Do města přijíždějí kupci z dalekých krajin. Vzácné zboží, exotická koření.",
    icon: "🏪",
  },
  {
    title: "Svátek měsíce",
    monthIndex: 6, // Měsíc sklizně
    dayRange: [1, 5],
    description: "Noc, kdy měsíc září nejjasněji. Mágové čerpají sílu z měsíčního svitu.",
    icon: "🌕",
  },
  {
    title: "Den vody",
    monthIndex: 2, // Měsíc květů
    dayRange: [10, 18],
    description: "Řeky jsou požehnány kněžími. Lidé pouští květiny po proudu pro štěstí.",
    icon: "💧",
  },
  {
    title: "Svátek ohně",
    monthIndex: 4, // Měsíc žáru
    dayRange: [1, 7],
    description: "Kováři a alchymisté slaví svůj patronát. Ulicemi prochází průvod s pochodněmi.",
    icon: "🔨",
  },
  {
    title: "Den díků",
    monthIndex: 8, // Měsíc listí
    dayRange: [20, 28],
    description: "Rodiny se scházejí ke společné hostině. Děkuje se za úrodu a zdraví.",
    icon: "🍂",
  },
  {
    title: "Festival masek",
    monthIndex: 9, // Měsíc mlh
    dayRange: [10, 20],
    description: "Lidé nosí masky a kostýmy. Nikdo neví, kdo je kdo — ideální čas pro intriky.",
    icon: "🎭",
  },
  {
    title: "Turnaj rytířů",
    monthIndex: 3, // Měsíc slunce
    dayRange: [15, 25],
    description: "Rytíři z celého království soupeří v klání a lukostřelbě. Král uděluje ceny.",
    icon: "🏰",
  },
  {
    title: "Noc duchů",
    monthIndex: 9, // Měsíc mlh
    dayRange: [25, 30],
    description: "O půlnoci prý duše zemřelých procházejí krajem. Vesničané zůstávají doma.",
    icon: "👻",
  },
  {
    title: "Ples na zámku",
    monthIndex: 5, // Měsíc bouří
    dayRange: [20, 28],
    description: "Šlechta pořádá velkolepý ples. Příležitost pro diplomacii, klepy i tanec.",
    icon: "💃",
  },
  {
    title: "Svátek lovců",
    monthIndex: 7, // Měsíc sklizně
    dayRange: [5, 12],
    description: "Lovci se vydávají na velkou výpravu. Kdo uloví největší zvěř, získává čest.",
    icon: "🏹",
  },
  {
    title: "Den knih",
    monthIndex: 0, // Měsíc probuzení
    dayRange: [20, 28],
    description: "Písaři a učenci vystavují vzácné svitky. Knihovny jsou otevřeny všem.",
    icon: "📚",
  },
  {
    title: "Obřad probuzení",
    monthIndex: 0, // Měsíc probuzení
    dayRange: [1, 8],
    description: "Země se probouzí po zimě. Kněží žehnají polím a sadům.",
    icon: "🌱",
  },
  {
    title: "Výročí korunovace",
    monthIndex: 6, // Měsíc sklizně
    dayRange: [12, 18],
    description: "Královský průvod prochází hlavním městem. Koruna je vystavena v katedrále.",
    icon: "👑",
  },
  {
    title: "Dětský den",
    monthIndex: 2, // Měsíc květů
    dayRange: [1, 8],
    description: "Děti dostávají drobné dárky. V ulicích se hrají hry, loutkové divadlo baví malé i velké.",
    icon: "🎈",
  },
];

/** Random integer in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Fisher-Yates shuffle (in-place). */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Generates 5 random calendar events for a chat. Each event gets a concrete
 *  day within its template's month/day range. Always picks from the full pool
 *  — calls are idempotent per-chat via the DB, so re-generation for an
 *  existing chat would produce a different set. */
export function generateCalendarEvents(chatId: string, year: number): CalendarEventTemplate[] {
  const shuffled = shuffle(EVENT_TEMPLATES).slice(0, 5);
  return shuffled.map((tpl) => {
    const month = MONTHS_LIST[tpl.monthIndex];
    const day = randInt(tpl.dayRange[0], tpl.dayRange[1]);
    return {
      id: crypto.randomUUID(),
      chatId,
      day: Math.min(30, day), // clamp to 30-day months
      monthName: month,
      year,
      title: tpl.title,
      description: tpl.description,
      icon: tpl.icon,
    };
  });
}

/** Ordered list of month genitive names (index 0 = Měsíce probuzení). */
const MONTHS_LIST: string[] = [
  "Měsíce probuzení",
  "Jarního větru",
  "Měsíce květů",
  "Měsíce slunce",
  "Měsíce žáru",
  "Měsíce bouří",
  "Měsíce sklizně",
  "Měsíce listí",
  "Měsíce mlh",
  "Měsíce mrazu",
  "Měsíce sněhu",
  "Měsíce temnoty",
];

/** Exported for UI display in the calendar panel. */
export const eventTemplates = EVENT_TEMPLATES;
