import type { Company } from "@/types";

const commonFields = ["RFC", "Razón social", "Código postal", "Uso CFDI"];

export const companies: Company[] = [
  ["oxxo", "OXXO", "https://www.oxxo.com/facturacion", "Automática", "Folio de venta y fecha"],
  ["walmart", "Walmart", "https://facturacion.walmartmexico.com.mx", "Automática", "TC y TR del ticket"],
  ["costco", "Costco", "https://www.costco.com.mx/facturacion", "Asistida", "Número de ticket"],
  ["liverpool", "Liverpool", "https://facturacion.liverpool.com.mx", "Asistida", "Código de facturación"],
  ["starbucks", "Starbucks", "https://alsea.interfactura.com", "Automática", "Ticket y sucursal"],
  ["home-depot", "Home Depot", "https://www.homedepot.com.mx/facturacion", "Asistida", "Número de compra"],
  ["office-depot", "Office Depot", "https://facturacion.officedepot.com.mx", "Próximamente", "Folio web"],
  ["soriana", "Soriana", "https://www.soriana.com/facturacion", "Asistida", "Ticket y tienda"],
  ["chedraui", "Chedraui", "https://facturacion.chedraui.com.mx", "Próximamente", "Folio de ticket"],
  ["farmacias-guadalajara", "Farmacias Guadalajara", "https://facturacion.farmaciasguadalajara.com", "Próximamente", "Referencia de compra"],
].map(([id, name, portalUrl, compatibility, rule]) => ({
  id,
  name,
  portalUrl,
  compatibility: compatibility as Company["compatibility"],
  requiredFields: commonFields,
  rule,
}));

