/** The big screen's lines over a boss kill's 4d20 (docs/designs/kill-roll.md), from the four dice and how many have
 * landed so far. The bonus is always their plain sum: no class die raises the finishing blow (class-dice-rework.md). */
export function killRollText(values: number[], landed: number): { chip: string; result: string; done: boolean } {
  const sum = values.reduce((a, b) => a + b, 0);
  const shown = values.slice(0, landed);
  const done = landed >= values.length;
  const result = done
    ? `${values.join(" + ")} = ${sum} 分`
    : shown.length > 1
      ? `${shown.join(" + ")} = ${shown.reduce((a, b) => a + b, 0)} …`
      : shown.length === 1
        ? `${shown[0]} …`
        : "";
  return { chip: "最後一擊！擲 4d20 擊殺獎勵", result, done };
}
