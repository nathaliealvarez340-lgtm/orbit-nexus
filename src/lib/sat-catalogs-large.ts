import "server-only";
import {
  curatedCatalogSource,
  type FiscalCatalogSource,
  type SearchableCatalogEntry,
} from "./fiscal-catalog-search";
// Curated subsets of c_ClaveProdServ (~52k codes) and c_ClaveUnidad (~2.4k codes).
// They are NOT the complete SAT catalogs (contract §13): a code outside them cannot be
// verified, so it is a blocking ERROR for READY (drafts still save). Server-side only.
const entry = (
  code: string,
  label: string,
  keywords?: string,
): SearchableCatalogEntry => ({
  code,
  label,
  active: true,
  ...(keywords ? { keywords } : {}),
});

const productServices = [
  entry("01010101", "No existe en el catálogo", "generico generica"),
  entry(
    "80101500",
    "Servicios de consultoría de negocios y administración corporativa",
    "consultoria asesoria",
  ),
  entry("80101600", "Gerencia de proyectos", "proyecto administracion"),
  entry("80111500", "Desarrollo de recursos humanos", "capacitacion personal"),
  entry("80111600", "Servicios de personal temporal", "personal temporal"),
  entry("80121600", "Servicios de derecho mercantil", "legal abogado juridico"),
  entry(
    "80131500",
    "Alquiler y arrendamiento de propiedades o edificaciones",
    "renta arrendamiento oficina local inmueble",
  ),
  entry("80141500", "Investigación de mercados", "estudio mercado"),
  entry(
    "80141600",
    "Actividades de ventas y promoción de negocios",
    "ventas promocion comision",
  ),
  entry("80161500", "Servicios de apoyo gerencial", "administrativo oficina"),
  entry("81101500", "Ingeniería civil", "construccion obra"),
  entry(
    "81111500",
    "Ingeniería de software o hardware",
    "desarrollo software programacion sistemas",
  ),
  entry("81111600", "Programadores de computador", "programacion desarrollo"),
  entry(
    "81111800",
    "Servicios de sistemas y administración de componentes de sistemas",
    "ti sistemas administracion",
  ),
  entry("81112000", "Servicios de datos", "datos procesamiento"),
  entry("81112100", "Servicios de internet", "hosting web internet"),
  entry(
    "81112200",
    "Mantenimiento y soporte de software",
    "soporte licencia software suscripcion",
  ),
  entry(
    "81112300",
    "Mantenimiento y soporte de hardware de computador",
    "soporte equipo computo",
  ),
  entry("82101500", "Publicidad impresa", "publicidad impresion"),
  entry("84111500", "Servicios contables", "contabilidad contador"),
  entry("84111600", "Auditoría", "auditoria"),
  entry("84111700", "Finanzas corporativas", "finanzas"),
  entry(
    "76111500",
    "Servicios de limpieza de edificios generales y de oficinas",
    "limpieza",
  ),
  entry(
    "72102900",
    "Servicios de mantenimiento y reparación de instalaciones",
    "mantenimiento reparacion",
  ),
  entry(
    "78101800",
    "Transporte de carga por carretera",
    "flete transporte carga",
  ),
  entry(
    "90101500",
    "Establecimientos para comer y beber",
    "restaurante alimentos comida",
  ),
];

const units = [
  entry("E48", "Unidad de servicio", "servicio"),
  entry("ACT", "Actividad"),
  entry("H87", "Pieza", "pza"),
  entry("EA", "Elemento"),
  entry("C62", "Uno"),
  entry("XUN", "Unidad"),
  entry("KT", "Kit"),
  entry("SET", "Conjunto"),
  entry("PR", "Par"),
  entry("XBX", "Caja"),
  entry("XPK", "Paquete"),
  entry("LO", "Lote"),
  entry("A9", "Tarifa"),
  entry("E51", "Trabajo"),
  entry("HUR", "Hora", "horas"),
  entry("MIN", "Minuto"),
  entry("DAY", "Día", "dias"),
  entry("WEE", "Semana"),
  entry("MON", "Mes", "mensual"),
  entry("ANN", "Año", "anual"),
  entry("KGM", "Kilogramo", "kg"),
  entry("GRM", "Gramo"),
  entry("MGM", "Miligramo", "mg"),
  entry("TNE", "Tonelada (métrica)"),
  entry("LTR", "Litro"),
  entry("MLT", "Mililitro", "ml"),
  entry("MTR", "Metro"),
  entry("CMT", "Centímetro", "cm"),
  entry("KMT", "Kilómetro", "km"),
  entry("MTK", "Metro cuadrado", "m2"),
  entry("MTQ", "Metro cúbico", "m3"),
  entry("KWH", "Kilowatt hora", "kwh"),
];

export const largeCatalogSources: Record<
  "product-services" | "units",
  FiscalCatalogSource
> = {
  "product-services": curatedCatalogSource(productServices),
  units: curatedCatalogSource(units),
};
export type LargeCatalogKey = keyof typeof largeCatalogSources;
export function isLargeCatalogKey(value: string): value is LargeCatalogKey {
  return Object.hasOwn(largeCatalogSources, value);
}
