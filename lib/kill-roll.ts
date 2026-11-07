/** The big screen's lines over a boss kill's 4d20 (docs/designs/kill-roll.md), from the four dice, the bonus the room
 * scores (`value`, a thief's sneak doubling included) and how many dice have landed so far. */
export function killRollText(values: number[], value: number, landed: number): { chip: string; result: string; done: boolean } {
  const sum = values.reduce((a, b) => a + b, 0);
  const multiplier = sum > 0 && value !== sum ? Math.round(value / sum) : 1;
  const shown = values.slice(0, landed);
  const done = landed >= values.length;
  const result = done
    ? multiplier > 1
      ? `${sum} × ${multiplier} = ${value} 分`
      : `${values.join(" + ")} = ${sum} 分`
    : shown.length > 1
      ? `${shown.join(" + ")} = ${shown.reduce((a, b) => a + b, 0)} …`
      : shown.length === 1
        ? `${shown[0]} …`
        : "";
  return { chip: `最後一擊！擲 4d20 擊殺獎勵${multiplier > 1 ? `（偷襲 ×${multiplier}）` : ""}`, result, done };
}
