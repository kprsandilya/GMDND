/** Dice notation parsing and rolling. The DM may always type a result instead of rolling. */

export interface DiceExpression {
  count: number;
  sides: number;
  modifier: number;
  raw: string;
}

const DICE_RE = /^\s*(\d*)d(\d+)\s*([+-]\s*\d+)?\s*$/i;

export function parseDice(expression: string): DiceExpression | null {
  const match = DICE_RE.exec(expression);
  if (!match) {
    const flat = Number(expression.trim());
    if (Number.isFinite(flat) && expression.trim() !== "") return { count: 0, sides: 0, modifier: flat, raw: expression.trim() };
    return null;
  }
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifier = match[3] ? Number(match[3].replace(/\s+/g, "")) : 0;
  if (count < 0 || count > 1000 || sides < 1 || sides > 1000) return null;
  return { count, sides, modifier, raw: expression.trim() };
}

export interface RollResult {
  total: number;
  rolls: number[];
  expression: DiceExpression;
}

export function roll(expression: string | DiceExpression, random: () => number = Math.random): RollResult {
  const parsed = typeof expression === "string" ? parseDice(expression) : expression;
  if (!parsed) throw new Error(`Invalid dice expression: ${String(expression)}`);
  const rolls: number[] = [];
  for (let i = 0; i < parsed.count; i++) rolls.push(1 + Math.floor(random() * parsed.sides));
  return { total: rolls.reduce((a, b) => a + b, 0) + parsed.modifier, rolls, expression: parsed };
}

export const d20 = (random: () => number = Math.random): number => 1 + Math.floor(random() * 20);

export const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);

export const formatModifier = (mod: number): string => (mod >= 0 ? `+${mod}` : `${mod}`);

export function averageOf(expression: string): number | null {
  const parsed = parseDice(expression);
  if (!parsed) return null;
  return Math.floor(parsed.count * ((parsed.sides + 1) / 2) + parsed.modifier);
}
