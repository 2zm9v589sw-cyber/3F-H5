import { randomBytes } from "crypto";

const PREFIX: Record<string, string> = {
  guide: "YD",
  repurchase: "FG"
};

export function makeCouponCode(typeCode: string, seq: number) {
  const tail = randomBytes(2).toString("hex").toUpperCase();
  return `CB3F-2607-${PREFIX[typeCode] || "XX"}-${String(seq).padStart(4, "0")}-${tail}`;
}
