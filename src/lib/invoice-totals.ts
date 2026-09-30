import { Prisma } from "@/generated/prisma/client";
export function invoiceTotals(
  concepts: { quantity: string; unitPrice: string; taxRate: string }[],
) {
  let subtotal = new Prisma.Decimal(0),
    tax = new Prisma.Decimal(0);
  const lines = concepts.map((c) => {
    const net = new Prisma.Decimal(c.quantity)
      .mul(c.unitPrice)
      .toDecimalPlaces(2);
    const vat = net.mul(c.taxRate).toDecimalPlaces(2);
    subtotal = subtotal.add(net);
    tax = tax.add(vat);
    return { net, tax: vat, total: net.add(vat) };
  });
  return { subtotal, tax, total: subtotal.add(tax), lines };
}
