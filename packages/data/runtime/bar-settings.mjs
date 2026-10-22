export function populateBarFields($, rule) {
  $("conditional-scale").value = rule?.scale?.kind ?? "auto";
  $("conditional-min").value = String(rule?.scale?.min ?? -100);
  $("conditional-max").value = String(rule?.scale?.max ?? 100);
  $("conditional-positive").value = rule?.positive ?? "acc";
  $("conditional-negative").value = rule?.negative ?? "alert";
}
export function readBarFields($) {
  const kind = $("conditional-scale").value;
  const finite = (id) => {
    const raw = $(id).value;
    if (!raw.trim() || !Number.isFinite(Number(raw)))
      throw new Error("Enter finite bar bounds.");
    return Number(raw);
  };
  return {
    kind: "dataBar",
    scale:
      kind === "auto"
        ? { kind }
        : {
            kind,
            min: finite("conditional-min"),
            max: finite("conditional-max"),
          },
    positive: $("conditional-positive").value,
    negative: $("conditional-negative").value,
  };
}
