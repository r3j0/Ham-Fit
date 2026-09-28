/** A compact display of server-derived decimals; never used for grade decisions. */
export function displayConvertedValue(value: string) {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length <= 6) return value;
  const visible = fraction.slice(0, 6).replace(/0+$/, "");
  if (whole === "0" && !visible) return "0.000001 미만";
  return `약 ${whole}${visible ? `.${visible}` : ""}`;
}
